import { Router } from "express";
import { stopAgent as agoraStopAgent } from "../agora/agent";
import { buildBatoMessages } from "../llm/bato";
import { LlmMessage } from "../llm/provider";
import { runSideJobs } from "../orchestration/turn";
import { buildBatoSystemPrompt } from "../scenario/content";
import { AppContext } from "../context";

const ROLES = ["system", "user", "assistant"];

function normalizeMessages(raw: unknown): LlmMessage[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (m): m is LlmMessage =>
        !!m &&
        typeof (m as LlmMessage).content === "string" &&
        ROLES.includes((m as LlmMessage).role)
    )
    .map((m) => ({ role: m.role, content: m.content }));
}

function lastUserContent(messages: LlmMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") return messages[i].content;
  }
  return "";
}

/**
 * The OpenAI-compatible endpoint the Conversational AI Engine calls each turn.
 * Streams Bato's reply (Call A) back as SSE for TTS, then fires the side jobs.
 */
export function customLlmRouter(ctx: AppContext): Router {
  const router = Router();

  router.post("/:sessionId/chat/completions", async (req, res) => {
    const { sessionId } = req.params;
    const doc = await ctx.store.get(sessionId);
    const stage = doc?.current_stage ?? 1;
    const engineMessages = normalizeMessages(req.body?.messages);
    const messages = buildBatoMessages(buildBatoSystemPrompt(stage, ctx.content), engineMessages);

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const id = `chatcmpl-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);
    const send = (obj: unknown) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

    // Reasoning models stream <think>; complete() strips it. Send the clean reply
    // as a single SSE chunk so TTS never voices the reasoning.
    let full = "";
    try {
      full = await ctx.provider.complete(messages, { temperature: 0.8, maxTokens: 1024 });
    } catch (err) {
      send({
        id,
        object: "chat.completion.chunk",
        created,
        choices: [{ index: 0, delta: { content: "" }, finish_reason: "stop" }],
        error: String(err)
      });
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }
    send({
      id,
      object: "chat.completion.chunk",
      created,
      choices: [{ index: 0, delta: { role: "assistant", content: full }, finish_reason: null }]
    });
    send({
      id,
      object: "chat.completion.chunk",
      created,
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }]
    });
    res.write("data: [DONE]\n\n");
    res.end();

    if (doc) {
      const negotiator = lastUserContent(engineMessages);
      const ts = new Date().toISOString();
      doc.transcript.push({ speaker: "negotiator", text: negotiator, ts });
      doc.transcript.push({ speaker: "bato", text: full, ts });
      await ctx.store.put(doc);

      // Live transcript to the frontend (so it shows the conversation without parsing Agora's data stream).
      ctx.bus.publish(sessionId, { type: "transcript", data: { speaker: "negotiator", text: negotiator, ts } });
      ctx.bus.publish(sessionId, { type: "transcript", data: { speaker: "bato", text: full, ts } });

      // Side jobs run off the reply path (Stage Judge + emotion + media).
      void runSideJobs(
        {
          store: ctx.store,
          bus: ctx.bus,
          provider: ctx.provider,
          stopAgent: async (sid) => {
            const d = await ctx.store.get(sid);
            if (d?.agent_id) {
              await agoraStopAgent(ctx.appId, d.agent_id);
            }
          }
        },
        sessionId,
        { negotiator, bato: full }
      );
    }
  });

  return router;
}
