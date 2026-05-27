import { randomUUID } from "crypto";
import { Router } from "express";
import { runBatoReply, transcriptToMessages } from "../llm/bato";
import { LlmMessage } from "../llm/provider";
import { runRubric } from "../llm/rubric";
import { runSideJobs } from "../orchestration/turn";
import { buildBatoSystemPrompt } from "../scenario/content";
import { AppContext } from "../context";

// Text-mode demo path: drives the same Bato/Judge/emotion/rubric engine over OpenAI
// WITHOUT the Agora voice loop — so it runs with only OPENAI_API_KEY configured.
// The production voice path (/api/llm + /api/session) is unchanged.

export function demoRouter(ctx: AppContext): Router {
  const router = Router();

  router.post("/start", async (_req, res) => {
    const sessionId = randomUUID();
    await ctx.store.create(sessionId, {
      scenario: "bato-dela-rosa",
      turn_mode: "push_to_talk"
    });
    // The negotiator (player) opens — Bato only responds once contacted.
    return res.status(201).json({
      session_id: sessionId,
      current_stage: 1,
      opening: "",
      scenario: "bato-dela-rosa"
    });
  });

  router.post("/:id/message", async (req, res) => {
    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    if (!text) return res.status(400).json({ error: "text is required" });

    const doc = await ctx.store.get(req.params.id);
    if (!doc) return res.status(404).json({ error: "session not found" });
    if (doc.outcome) {
      return res.status(409).json({ error: "session already ended", outcome: doc.outcome });
    }

    const history: LlmMessage[] = [
      ...transcriptToMessages(doc.transcript),
      { role: "user", content: text }
    ];

    let reply = "";
    try {
      reply = await runBatoReply(
        ctx.provider,
        buildBatoSystemPrompt(doc.current_stage, ctx.content),
        history
      );
    } catch (err) {
      return res.status(502).json({ error: `LLM error: ${String(err)}` });
    }

    const ts = new Date().toISOString();
    doc.transcript.push({ speaker: "negotiator", text, ts });
    doc.transcript.push({ speaker: "bato", text: reply, ts });
    await ctx.store.put(doc);

    // Stage Judge + emotion + coaching + press + gating (also emits SSE).
    await runSideJobs(
      { store: ctx.store, bus: ctx.bus, provider: ctx.provider },
      req.params.id,
      { negotiator: text, bato: reply }
    );

    const updated = await ctx.store.get(req.params.id);
    if (updated && updated.outcome && updated.rubric.total15 === null) {
      try {
        const r = await runRubric(ctx.provider, updated.transcript);
        updated.rubric = { perStage: r.perStage, total15: r.total15 };
        await ctx.store.put(updated);
      } catch {
        // leave rubric unset if scoring fails
      }
    }
    return res.json({ reply, session: updated });
  });

  router.post("/:id/finish", async (req, res) => {
    const doc = await ctx.store.get(req.params.id);
    if (!doc) return res.status(404).json({ error: "session not found" });
    if (!doc.outcome) doc.outcome = "partial";
    try {
      const r = await runRubric(ctx.provider, doc.transcript);
      doc.rubric = { perStage: r.perStage, total15: r.total15 };
    } catch {
      // leave rubric as-is
    }
    await ctx.store.put(doc);
    return res.json({ session: await ctx.store.get(req.params.id) });
  });

  return router;
}
