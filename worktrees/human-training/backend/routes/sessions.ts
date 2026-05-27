import { randomUUID } from "crypto";
import { Router } from "express";
import { RtcRole, RtcTokenBuilder } from "agora-token";
import { startAgent, stopAgent as agoraStopAgent } from "../agora/agent";
import { runRubric } from "../llm/rubric";
import { TurnMode } from "../session/store";
import { AppContext } from "../context";

function parseTurnMode(value: unknown): TurnMode {
  return value === "open_mic" ? "open_mic" : "push_to_talk";
}

function ttsParamsFromEnv(): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  if (process.env.TTS_KEY) params.key = process.env.TTS_KEY;
  if (process.env.TTS_REGION) params.region = process.env.TTS_REGION;
  return params;
}

export function sessionsRouter(ctx: AppContext): Router {
  const router = Router();

  router.post("/start", async (req, res) => {
    if (!ctx.appId || !ctx.appCertificate) {
      return res
        .status(500)
        .json({ error: "AGORA_APP_ID and AGORA_APP_CERTIFICATE must be configured." });
    }

    const sessionId = randomUUID();
    const channel = `leverage-${sessionId.slice(0, 8)}`;
    const turn_mode = parseTurnMode(req.body?.turn_mode);
    const scenario = typeof req.body?.scenario === "string" ? req.body.scenario : "bato-dela-rosa";
    const userUid = Math.floor(Math.random() * 100000);

    const tokenFor = (uid: number) =>
      RtcTokenBuilder.buildTokenWithUid(
        ctx.appId,
        ctx.appCertificate,
        channel,
        uid,
        RtcRole.PUBLISHER,
        ctx.tokenExpire,
        ctx.tokenExpire
      );

    const doc = await ctx.store.create(sessionId, { scenario, turn_mode, channel });

    try {
      const { agentId } = await startAgent(ctx.appId, {
        channel,
        agentRtcToken: tokenFor(0),
        llmBaseUrl: ctx.llmBaseUrl,
        sessionId,
        greeting: process.env.BATO_GREETING || "",
        ttsVendor: process.env.TTS_VENDOR,
        ttsVoice: process.env.TTS_VOICE,
        ttsKey: process.env.TTS_KEY,
        ttsRegion: process.env.TTS_REGION,
        model: process.env.OPENAI_MODEL || "gpt-4o"
      });
      doc.agent_id = agentId;
      await ctx.store.put(doc);

      return res.status(201).json({
        session_id: sessionId,
        agora: {
          appId: ctx.appId,
          channelName: channel,
          uid: userUid,
          token: tokenFor(userUid),
          expiresIn: ctx.tokenExpire
        },
        agent_id: agentId,
        stage: { current: 1, passed: false },
        turn_mode
      });
    } catch (err) {
      return res
        .status(502)
        .json({ error: `Failed to start agent: ${String(err)}`, session_id: sessionId });
    }
  });

  router.post("/:id/stop", async (req, res) => {
    const doc = await ctx.store.get(req.params.id);
    if (!doc) return res.status(404).json({ error: "session not found" });

    if (doc.agent_id) {
      try {
        await agoraStopAgent(ctx.appId, doc.agent_id);
      } catch {
        // best-effort
      }
    }

    try {
      const result = await runRubric(ctx.provider, doc.transcript);
      doc.rubric = { perStage: result.perStage, total15: result.total15 };
    } catch {
      // leave rubric as-is if scoring fails
    }

    if (!doc.outcome) {
      doc.outcome = doc.current_stage >= 5 ? "partial" : "disengaged";
    }
    await ctx.store.put(doc);

    return res.json({
      outcome: doc.outcome,
      final_stage_reached: doc.current_stage,
      report_ready: true
    });
  });

  router.get("/:id", async (req, res) => {
    const doc = await ctx.store.get(req.params.id);
    if (!doc) return res.status(404).json({ error: "session not found" });
    return res.json(doc);
  });

  router.patch("/:id/turn-mode", async (req, res) => {
    const doc = await ctx.store.get(req.params.id);
    if (!doc) return res.status(404).json({ error: "session not found" });
    doc.turn_mode = parseTurnMode(req.body?.turn_mode);
    await ctx.store.put(doc);
    return res.json({ turn_mode: doc.turn_mode });
  });

  router.get("/:id/events", (req, res) => {
    const sessionId = req.params.id;
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();
    res.write(`event: ready\ndata: ${JSON.stringify({ session_id: sessionId })}\n\n`);

    const off = ctx.bus.subscribe(sessionId, (event) => {
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
    });
    const keepAlive = setInterval(() => res.write(": keep-alive\n\n"), 15000);
    req.on("close", () => {
      clearInterval(keepAlive);
      off();
    });
  });

  return router;
}
