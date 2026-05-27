import cors from "cors";
import dotenv from "dotenv";
import express, { NextFunction, Request, Response } from "express";
import { RtcRole, RtcTokenBuilder } from "agora-token";
import { createContext } from "./context";
import { customLlmRouter } from "./routes/customLlm";
import { demoRouter } from "./routes/demo";
import { sessionsRouter } from "./routes/sessions";

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 4000);
const ctx = createContext();

app.use(cors({ origin: true })); // demo: reflect any origin (no credentials)
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req: Request, res: Response) => {
  res.json({ ok: true, service: "leverage-backend" });
});

app.get("/api/agora/token", (req: Request, res: Response) => {
  if (!ctx.appId || !ctx.appCertificate) {
    return res
      .status(500)
      .json({ error: "AGORA_APP_ID and AGORA_APP_CERTIFICATE must be configured." });
  }
  const channelName = String(req.query.channelName || "leverage-crisis-room");
  const uid = Number(req.query.uid || Math.floor(Math.random() * 100000));
  const token = RtcTokenBuilder.buildTokenWithUid(
    ctx.appId,
    ctx.appCertificate,
    channelName,
    uid,
    RtcRole.PUBLISHER,
    ctx.tokenExpire,
    ctx.tokenExpire
  );
  return res.json({ appId: ctx.appId, channelName, uid, token, expiresIn: ctx.tokenExpire });
});

// The OpenAI-compatible endpoint the Conversational AI Engine calls (Bato).
app.use("/api/llm", customLlmRouter(ctx));
// Session lifecycle + SSE events for the frontend.
app.use("/api/session", sessionsRouter(ctx));
// Text-mode MVP demo (OpenAI only, no Agora voice loop).
app.use("/api/demo", demoRouter(ctx));

app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(error);
  res.status(500).json({ error: "Internal server error" });
});

app.listen(port, () => {
  console.log(`Leverage backend listening on http://localhost:${port}`);
});
