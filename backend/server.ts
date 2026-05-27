import cors from "cors";
import dotenv from "dotenv";
import express, { Request, Response } from "express";
import { RtcRole, RtcTokenBuilder } from "agora-token";
import { GameStage, getGameState, updateGameState } from "./db";

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 4000);

app.use(
  cors({
    origin: process.env.FRONTEND_ORIGIN || "http://localhost:5173"
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
