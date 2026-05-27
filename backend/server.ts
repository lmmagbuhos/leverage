import cors from "cors";
import dotenv from "dotenv";
import express, { Request, Response } from "express";
import { RtcRole, RtcTokenBuilder } from "agora-token";
import { GameStage, getGameState, updateGameState, initDb, saveCanonicalRun, getCanonicalRun } from "./db";
import type { CanonicalRun } from "./db";
import { createSession, getSession, processTurn, runBcsmEvaluation, AGENT_PRESETS, PERSONA_IDS } from "./benchmark";
import type { TurnResponse, EvaluationResult } from "./benchmark";
import { createOpenAIClient } from "./agent";

dotenv.config();

initDb().catch(console.error);

const app = express();
const port = Number(process.env.PORT || 4000);

const allowedOrigins = (process.env.FRONTEND_ORIGIN || "http://localhost:5173").split(",").map(s => s.trim());
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      cb(new Error(`CORS: origin ${origin} not allowed`));
    }
  })
);
app.use(express.json());

app.get("/health", (_req: Request, res: Response) => {
  res.json({ ok: true, service: "leverage-backend" });
});

app.get("/api/agora/token", (req: Request, res: Response) => {
  const channelName = String(req.query.channelName || "leverage-crisis-room");
  const uid = Number(req.query.uid || Math.floor(Math.random() * 100000));
  const appId = process.env.AGORA_APP_ID;
  const appCertificate = process.env.AGORA_APP_CERTIFICATE;
  const expiresIn = Number(process.env.AGORA_TOKEN_EXPIRE_SECONDS || 3600);

  if (!appId || !appCertificate) {
    return res.status(500).json({
      error: "AGORA_APP_ID and AGORA_APP_CERTIFICATE must be configured."
    });
  }

  const token = RtcTokenBuilder.buildTokenWithUid(
    appId,
    appCertificate,
    channelName,
    uid,
    RtcRole.PUBLISHER,
    expiresIn,
    expiresIn
  );

  return res.json({
    appId,
    channelName,
    uid,
    token,
    expiresIn
  });
});

app.get("/api/game/state", async (req: Request, res: Response) => {
  const sessionId = String(req.query.session_id || "demo-session");
  const state = await getGameState(sessionId);

  return res.json(state);
});

app.post("/api/game/state", async (req: Request, res: Response) => {
  const sessionId = String(req.body.session_id || "demo-session");
  const currentStage = Number(req.body.current_stage);
  const state = await updateGameState(sessionId, {
    stress_level:
      typeof req.body.stress_level === "number" ? req.body.stress_level : undefined,
    stress_delta:
      typeof req.body.stress_delta === "number" ? req.body.stress_delta : undefined,
    current_stage: [1, 2, 3].includes(currentStage)
      ? (currentStage as GameStage)
      : undefined
  });

  return res.json(state);
});

// ─── Lazy OpenAI client ───────────────────────────────────────────────────────
let _openai: ReturnType<typeof createOpenAIClient> | null = null;
function getOpenAI(): ReturnType<typeof createOpenAIClient> {
  if (!_openai) _openai = createOpenAIClient();
  return _openai;
}

// ─── TTS endpoint ────────────────────────────────────────────────────────────

app.post("/api/tts", async (req: Request, res: Response) => {
  const text = String(req.body.text || "").trim();
  const isAgent = req.body.isAgent === true;
  if (!text) return res.status(400).json({ error: "text is required" });

  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "MINIMAX_API_KEY not configured" });

  try {
    const voice = isAgent ? "male-qn-qingse" : "female-shaonv";
    const ttRes = await fetch("https://api.minimaxi.chat/v1/t2a_v2", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "speech-01-turbo",
        text,
        stream: false,
        voice_setting: { voice_id: voice, speed: 1.0, vol: 1.0, pitch: 0 },
        audio_setting: { sample_rate: 32000, bitrate: 128000, format: "mp3" },
      }),
    });

    const json = await ttRes.json() as { data?: { audio?: string }; base_resp?: { status_code: number; status_msg: string } };

    if (json.base_resp?.status_code !== 0) {
      console.error("MiniMax TTS error:", json.base_resp?.status_msg);
      return res.status(503).json({ error: json.base_resp?.status_msg ?? "TTS unavailable" });
    }

    const audioHex = json.data?.audio ?? "";
    const buffer = Buffer.from(audioHex, "hex");
    res.set("Content-Type", "audio/mpeg");
    return res.send(buffer);
  } catch (err) {
    console.error("TTS error:", (err as Error).message);
    return res.status(500).json({ error: "TTS generation failed" });
  }
});

// ─── Benchmark endpoints ──────────────────────────────────────────────────────

app.get("/api/benchmark/presets", (_req: Request, res: Response) => {
  return res.json(
    AGENT_PRESETS.map(({ id, label, description, group }) => ({ id, label, description, group }))
  );
});

app.post("/api/benchmark/start", async (req: Request, res: Response) => {
  const agentLabel = String(req.body.agentLabel || "Test Agent");
  const agentPresetId = String(req.body.agentPresetId || "master");
  const customSystemPrompt = typeof req.body.customSystemPrompt === "string"
    ? req.body.customSystemPrompt
    : undefined;
  const force = req.body.force === true;

  // For persona presets: check Couchbase for a saved canonical run (unless force=true)
  if (!force && PERSONA_IDS.has(agentPresetId)) {
    try {
      const canonical = await getCanonicalRun(agentPresetId);
      if (canonical && (canonical.turns as unknown[]).length > 0) {
        const session = createSession(agentLabel, agentPresetId, customSystemPrompt);
        session.mode = "replay";
        session.replayTurns = canonical.turns as TurnResponse[];
        session.replayIndex = 0;
        session.evaluation = canonical.evaluation as EvaluationResult;
        return res.json({
          sessionId: session.sessionId,
          stage: session.currentStage,
          status: session.status,
          agentLabel: session.agentLabel,
          agentPresetId: session.agentPresetId,
          mode: session.mode,
        });
      }
    } catch (err) {
      console.warn("Canonical run lookup failed, starting live session:", (err as Error).message);
    }
  }

  const session = createSession(agentLabel, agentPresetId, customSystemPrompt);
  return res.json({
    sessionId: session.sessionId,
    stage: session.currentStage,
    status: session.status,
    agentLabel: session.agentLabel,
    agentPresetId: session.agentPresetId,
    mode: session.mode,
  });
});

app.post("/api/benchmark/turn", async (req: Request, res: Response) => {
  const sessionId = String(req.body.sessionId || "");
  const session = getSession(sessionId);
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }
  if (session.status === "completed" || session.status === "failed") {
    return res.status(400).json({ error: `Session already ${session.status}` });
  }
  const result = await processTurn(getOpenAI(), session);
  return res.json(result);
});

app.post("/api/benchmark/evaluate", async (req: Request, res: Response) => {
  const sessionId = String(req.body.sessionId || "");
  const session = getSession(sessionId);
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }

  // Replay mode: return cached evaluation without re-running LLM
  if (session.mode === "replay" && session.evaluation) {
    return res.json(session.evaluation);
  }

  const evaluation = await runBcsmEvaluation(getOpenAI(), session);
  session.evaluation = evaluation;
  evaluation.stages.forEach((s) => {
    const existing = session.stageResults.find((r) => r.stage === s.stage);
    if (existing) existing.score = s.score;
  });

  // Save canonical run to Couchbase for persona presets
  if (PERSONA_IDS.has(session.agentPresetId)) {
    const canonicalData: CanonicalRun = {
      personaId: session.agentPresetId,
      turns: session.recordedTurns,
      history: session.history,
      stageResults: session.stageResults,
      evaluation,
      savedAt: new Date().toISOString(),
    };
    saveCanonicalRun(session.agentPresetId, canonicalData).catch((err) =>
      console.warn("Failed to save canonical run:", (err as Error).message)
    );
  }

  return res.json(evaluation);
});

app.use(
  (
    error: Error,
    _req: Request,
    res: Response,
    _next: express.NextFunction
  ) => {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
);

app.listen(port, () => {
  console.log(`Leverage backend listening on http://localhost:${port}`);
});
