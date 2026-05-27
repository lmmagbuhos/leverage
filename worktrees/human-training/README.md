# Leverage Human Training

Leverage Human Training is a browser-based crisis-negotiation training demo. The human user plays the negotiator, speaks through Agora RTC, and Bato dela Rosa is driven by an LLM through the Agora Conversational AI Engine.

The current human-training flow uses:

- Agora RTC SDK in the Vue frontend for mic capture, channel join, and Bato audio playback.
- Agora Conversational AI Engine on the backend for managed ASR, TTS, turn-taking, and agent channel participation.
- A custom OpenAI-compatible `/chat/completions` endpoint hosted by this backend so the engine can ask our Bato scenario engine for each reply.
- Server-sent events from the backend for derived training signals: transcript copies, Bato emotion, stage updates, coaching, press, and session end.

## Repo Layout

| Path | Purpose |
|---|---|
| `frontend/src/views/AgoraVoice.vue` | Main voice training UI using `agora-rtc-sdk-ng` |
| `frontend/src/views/TrainingDemo.vue` | Text-only fallback demo that does not require Agora |
| `backend/agora/agent.ts` | Agora Conversational AI Engine join/leave integration |
| `backend/routes/sessions.ts` | Session lifecycle, Agora token minting, agent start/stop, SSE events |
| `backend/routes/customLlm.ts` | Per-session OpenAI-compatible endpoint called by the Agora engine |
| `backend/routes/demo.ts` | Text-mode endpoint for OpenAI-only testing |
| `backend/llm/` | Bato, judge, emotion, media, and rubric LLM calls |
| `backend/scenario/` | Scenario/stage content loader |
| `bato-files-with-objectives/` | Bato character files, stage files, agendas, player objectives, and rubric |

## How Agora Is Used

### 1. Browser joins RTC

The root route `/` renders `AgoraVoice.vue`.

When the user clicks **Start Call**, the frontend calls:

```http
POST /api/session/start
```

The response includes:

```json
{
  "session_id": "uuid",
  "agora": {
    "appId": "AGORA_APP_ID",
    "channelName": "leverage-<session>",
    "uid": 12345,
    "token": "rtc-token",
    "expiresIn": 3600
  },
  "agent_id": "agora-agent-id",
  "turn_mode": "push_to_talk"
}
```

The frontend then uses `agora-rtc-sdk-ng` to:

1. Create an RTC client.
2. Join the returned channel.
3. Create and publish the local microphone track.
4. Keep the mic muted by default for push-to-talk.
5. Subscribe to remote audio and play Bato's TTS audio when the Agora agent publishes it.

### 2. Backend starts the Conversational AI Engine agent

`backend/routes/sessions.ts` creates the training session, mints RTC tokens, and calls `startAgent()` from `backend/agora/agent.ts`.

`startAgent()` calls Agora's Conversational AI Engine join API:

```text
POST https://api.agora.io/api/conversational-ai-agent/v2/projects/{AGORA_APP_ID}/join
```

The join body gives the engine:

- The RTC channel name.
- An RTC token for the agent UID.
- The agent RTC UID, currently `"0"`.
- ASR language, currently `en-US`.
- Optional TTS vendor/voice configuration.
- A custom LLM URL for this session.

The important routing detail is the LLM URL:

```text
{LLM_BASE_URL}/api/llm/{session_id}/chat/completions
```

The `session_id` is embedded in the path because the Agora engine does not send custom routing headers. The backend uses that path segment to load the correct session, current BCSM stage, and scenario context.

### 3. Agora engine calls our custom LLM endpoint

The engine sends each user turn to:

```http
POST /api/llm/:sessionId/chat/completions
```

`backend/routes/customLlm.ts` behaves like an OpenAI Chat Completions streaming endpoint:

1. It normalizes the engine-provided messages.
2. It reads the current session and stage.
3. It injects the Bato character prompt plus the active stage context.
4. It calls the configured OpenAI-compatible provider.
5. It streams Bato's reply back as `chat.completion.chunk` SSE for the Agora engine to speak through TTS.
6. After the reply, it records the exchange and runs side jobs for stage judging, emotion, coaching, press, and session updates.

### 4. Backend SSE drives the training panels

The frontend opens:

```http
GET /api/session/:id/events
```

Current event types include:

- `transcript`
- `stage_update`
- `bato_emotion`
- `coaching`
- `press`
- `session_end`

These events are separate from Agora RTC media. Agora carries the live audio path; backend SSE carries the app-specific training state.

## Setup

Install dependencies:

```bash
npm install
```

Create backend env:

```bash
cp backend/.env.example backend/.env
```

Minimum backend variables for the voice path:

```env
PORT=6000
FRONTEND_ORIGIN=http://localhost:6001

OPENAI_API_KEY=your-openai-compatible-key
OPENAI_MODEL=gpt-4o
OPENAI_BASE_URL=

AGORA_APP_ID=your-agora-app-id
AGORA_APP_CERTIFICATE=your-agora-app-certificate
AGORA_CUSTOMER_ID=your-agora-rest-customer-id
AGORA_CUSTOMER_SECRET=your-agora-rest-customer-secret
AGORA_TOKEN_EXPIRE_SECONDS=3600

LLM_BASE_URL=https://your-public-backend-url
```

Optional TTS variables:

```env
TTS_VENDOR=microsoft
TTS_KEY=your-tts-key
TTS_REGION=your-tts-region
TTS_VOICE=en-US-AndrewMultilingualNeural
```

`OPENAI_BASE_URL` can point to another OpenAI-compatible provider. Leave it empty for the default OpenAI API.

`LLM_BASE_URL` must be reachable by Agora's cloud service. For local development, expose the backend with a tunnel such as ngrok and set `LLM_BASE_URL` to the public HTTPS tunnel URL. `http://localhost:6000` only works for browser-to-backend calls on your machine; Agora cannot call that address from the cloud.

## Running Locally

The current Vite config serves the frontend on port `6001` and proxies `/api` to `http://localhost:6000`.

Start the backend:

```bash
PORT=6000 npm run dev:backend
```

Start the frontend:

```bash
npm run dev:frontend
```

Open:

```text
http://localhost:6001
```

For the real Agora voice loop, also expose the backend:

```bash
ngrok http 6000
```

Then set:

```env
LLM_BASE_URL=https://<your-ngrok-domain>
```

Restart the backend after changing `.env`.

## Text-Only Fallback

Route:

```text
/text
```

The text demo uses the same Bato, judge, emotion, media, and rubric logic without the Agora voice loop. It requires the LLM provider configuration but does not require Agora credentials.

## API Summary

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/health` | Backend health check |
| `GET` | `/api/agora/token` | Mint a standalone Agora RTC token |
| `POST` | `/api/session/start` | Create a training session and start the Agora Conversational AI agent |
| `POST` | `/api/session/:id/stop` | Stop the Agora agent and finalize the session |
| `GET` | `/api/session/:id` | Fetch the full session document |
| `PATCH` | `/api/session/:id/turn-mode` | Set `push_to_talk` or `open_mic` on the session |
| `GET` | `/api/session/:id/events` | SSE stream for transcript and training signals |
| `POST` | `/api/llm/:sessionId/chat/completions` | Internal custom LLM callback for the Agora engine |
| `POST` | `/api/demo/start` | Start a text-only session |
| `POST` | `/api/demo/:id/message` | Send a text-only negotiator message |
| `POST` | `/api/demo/:id/finish` | Finish and score a text-only session |

## Known Limitations

- The real voice path requires a public `LLM_BASE_URL`; Agora cannot call a local-only backend URL.
- The Vite dev proxy expects the backend on port `6000`. If the backend runs on `4000`, update `frontend/vite.config.ts` or set `PORT=6000`.
- The frontend currently uses push-to-talk by muting/unmuting the published mic track. `open_mic` exists in the API but is not the default UI behavior.
- The frontend does not currently renew Agora RTC tokens on `token-privilege-will-expire`; keep demo sessions within `AGORA_TOKEN_EXPIRE_SECONDS` or add renewal before longer runs.
- `customLlm.ts` sends Bato's reply as a single OpenAI-compatible SSE chunk after completion so reasoning tags can be stripped before TTS. This is compatible with the engine callback shape, but it is not token-by-token streaming yet.
- The UI currently consumes backend SSE transcript copies and derived events. It does not yet parse Agora data-stream transcript events or Marsview prosody payloads directly.
- Session storage is in-memory in the current implementation. Restarting the backend loses active sessions unless persistence is added.
- CORS is permissive for demo use (`origin: true`). Lock this down before production deployment.
- TTS behavior depends on the configured Agora Conversational AI Engine TTS vendor and credentials. If no `TTS_KEY` is configured, the join body omits explicit TTS settings.

## Verification Commands

```bash
npm --prefix backend run test
npm --prefix backend run build
npm --prefix frontend run build
```

For end-to-end voice verification, run the backend and frontend, expose the backend publicly, start a call from `/`, and confirm:

1. `/api/session/start` returns an `agent_id`.
2. The browser joins the returned RTC channel.
3. The mic publishes only when push-to-talk is active.
4. Bato audio plays through Agora RTC.
5. `/api/session/:id/events` emits transcript, emotion, stage, coaching, and press events.
