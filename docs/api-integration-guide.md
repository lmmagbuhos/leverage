# Leverage Backend — API Integration Guide

Base URL (production): configure via environment  
Base URL (local dev): `http://localhost:4000`

All endpoints accept and return `application/json`. The benchmark session is stored **in-memory on the server** — sessions are lost on server restart.

---

## CORS

Add your frontend origin to the backend `.env`:

```
FRONTEND_ORIGIN=http://localhost:5173,https://your-frontend-domain.com
```

---

## Endpoints

### Health

```
GET /health
```

Response:
```json
{ "ok": true, "service": "leverage-backend" }
```

---

### Agora RTC Token

Used by the crisis dashboard (human negotiator voice room). Not required for the benchmark page.

```
GET /api/agora/token?channelName=leverage-crisis-room&uid=12345
```

| Query param | Type | Default |
|---|---|---|
| `channelName` | string | `"leverage-crisis-room"` |
| `uid` | number | random |

Response:
```json
{
  "appId": "string",
  "channelName": "string",
  "uid": 12345,
  "token": "string",
  "expiresIn": 3600
}
```

---

### Game State (Crisis Dashboard)

Used by the crisis dashboard to track stress level and stage for a human negotiation session. Not required for the benchmark page.

```
GET /api/game/state?session_id=demo-session
```

```
POST /api/game/state
Body: {
  "session_id": "demo-session",
  "stress_level": 65,        // absolute value 0–100 (optional)
  "stress_delta": -10,       // relative change (optional, used if stress_level absent)
  "current_stage": 2         // 1 | 2 | 3 (optional, derived from stress if omitted)
}
```

Response (`GameState`):
```json
{
  "session_id": "demo-session",
  "stress_level": 65,
  "current_stage": 2,
  "updated_at": "2026-05-27T08:00:00.000Z"
}
```

Stage derivation from stress:
- stress ≤ 30 → stage 3
- stress ≤ 60 → stage 2
- stress > 60 → stage 1

---

## Benchmark API

The benchmark runs an AI agent against Bato dela Rosa across 5 BCSM stages. The server orchestrates three LLM calls per turn: agent move → Bato reply → stage evaluation. Your frontend drives the loop.

### Session lifecycle

```
[idle] → start → [running] → turn loop → [completed | failed]
                                ↑ hold
```

---

### 1. Get Agent Presets

```
GET /api/benchmark/presets
```

Response — array of presets:
```json
[
  {
    "id": "master",
    "label": "Master Negotiator",
    "description": "Full BCSM-trained negotiator using the gold-standard technique guide."
  },
  {
    "id": "untrained",
    "label": "Untrained Agent",
    "description": "Basic conversational agent with no specific BCSM training."
  },
  {
    "id": "aggressive",
    "label": "Aggressive Negotiator",
    "description": "Applies pressure and urgency. Does not follow BCSM stage sequencing."
  },
  {
    "id": "custom",
    "label": "Custom Agent",
    "description": "User-defined agent persona and instructions."
  }
]
```

Fetch this on page load and render as selectable options. The `systemPrompt` field is intentionally excluded from this response.

---

### 2. Start a Session

```
POST /api/benchmark/start
```

Body:
```json
{
  "agentLabel": "My Test Agent",
  "agentPresetId": "master",
  "customSystemPrompt": "..."
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `agentLabel` | string | no | Display name. Default: `"Test Agent"` |
| `agentPresetId` | `"master"` \| `"untrained"` \| `"aggressive"` \| `"custom"` | no | Default: `"master"` |
| `customSystemPrompt` | string | only when `agentPresetId = "custom"` | Full system prompt for the agent |

Response:
```json
{
  "sessionId": "bench-1716800000000-abc12",
  "stage": 1,
  "status": "idle",
  "agentLabel": "My Test Agent",
  "agentPresetId": "master"
}
```

Store `sessionId` — every subsequent call requires it.

---

### 3. Process a Turn

Each call triggers one full exchange: the agent speaks, Bato replies, and the evaluator assesses whether the stage advances.

```
POST /api/benchmark/turn
```

Body:
```json
{ "sessionId": "bench-1716800000000-abc12" }
```

Response (`TurnResponse`):
```json
{
  "agentMove": "Bato, I hear you. Thirty-three years is a long time...",
  "batoReply": "You think you understand? You weren't there.",
  "emotion": "guarded",
  "result": "held",
  "reason": "Bato remains defensive; no emotional disclosure yet.",
  "newStage": 1,
  "sessionStatus": "running"
}
```

| Field | Values | Meaning |
|---|---|---|
| `result` | `"advanced"` | Stage success criteria met — `newStage` incremented |
| `result` | `"held"` | Neither advance nor fail — call turn again |
| `result` | `"failed"` | Failure criteria triggered — session ends |
| `sessionStatus` | `"running"` | Keep looping |
| `sessionStatus` | `"completed"` | All 5 stages passed — call `/evaluate` |
| `sessionStatus` | `"failed"` | Session ended early — call `/evaluate` |

`emotion` is one of: `guarded`, `suspicious`, `angry`, `exhausted`, `sad`, `open`, `fearful`, `hopeful`, `resolved`

**Error responses:**
- `404` — session not found
- `400` — session already completed or failed

---

### 4. Run Final Evaluation

Call this once `sessionStatus` is `"completed"` or `"failed"`. Sends the full transcript to the LLM for BCSM scoring.

```
POST /api/benchmark/evaluate
```

Body:
```json
{ "sessionId": "bench-1716800000000-abc12" }
```

Response (`EvaluationResult`):
```json
{
  "stages": [
    {
      "stage": 1,
      "score": 2,
      "positives": ["Reflected Bato's frustration accurately", "No premature advice-giving"],
      "negatives": ["Missed opportunity to name the emotion explicitly"],
      "narrative": "The agent demonstrated solid active listening but did not fully validate the depth of betrayal Bato expressed."
    },
    {
      "stage": 2,
      "score": 3,
      "positives": ["Bato voluntarily disclosed fear of exposure"],
      "negatives": [],
      "narrative": "Empathy was well-established. Bato opened up without prompting."
    },
    { "stage": 3, "score": 0, "positives": [], "negatives": [], "narrative": "Stage not reached." },
    { "stage": 4, "score": 0, "positives": [], "negatives": [], "narrative": "Stage not reached." },
    { "stage": 5, "score": 0, "positives": [], "negatives": [], "narrative": "Stage not reached." }
  ],
  "totalScore": 5,
  "overallAssessment": "The agent built initial trust but the session ended before reaching the influence stage.",
  "keyImprovementAreas": [
    "Introduce future-oriented framing earlier",
    "Acknowledge Bato's loyalty narrative before challenging it"
  ]
}
```

Scoring per stage: **0–3**  
Total: **0–15**

| Total | Band |
|---|---|
| 13–15 | Exceptional |
| 10–12 | Good |
| 7–9 | Adequate |
| 4–6 | Poor |
| 0–3 | Critical Failure |

---

## Complete Frontend Integration Flow

### Step 1 — On page load

```js
const presets = await fetch(`${API_BASE}/api/benchmark/presets`).then(r => r.json());
// Render preset selector buttons
```

### Step 2 — On Start

```js
const { sessionId } = await fetch(`${API_BASE}/api/benchmark/start`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    agentLabel: "Master Negotiator",
    agentPresetId: "master",
    // customSystemPrompt: "..." // only when agentPresetId = "custom"
  })
}).then(r => r.json());
```

### Step 3 — Turn loop

```js
let running = true;

while (running) {
  const turn = await fetch(`${API_BASE}/api/benchmark/turn`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId })
  }).then(r => r.json());

  // Render agent message
  renderMessage({ role: "agent", text: turn.agentMove, stage: turn.newStage });
  // Speak agent message (see Voice section below)
  await speak(turn.agentMove, "agent");

  // Render Bato message
  renderMessage({ role: "bato", text: turn.batoReply, stage: turn.newStage, emotion: turn.emotion });
  // Speak Bato reply
  await speak(turn.batoReply, "bato");

  // Update stage indicator
  updateStage(turn.newStage);

  if (turn.sessionStatus === "completed" || turn.sessionStatus === "failed") {
    running = false;
  }
}
```

### Step 4 — Evaluate

```js
const evaluation = await fetch(`${API_BASE}/api/benchmark/evaluate`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ sessionId })
}).then(r => r.json());

// Render evaluation.stages[], evaluation.totalScore, evaluation.overallAssessment
```

---

## Voice (Text-to-Speech)

Voice is implemented entirely on the **frontend** using the browser's Web Speech API — no backend endpoint required. Each message text received from the API is passed directly to `SpeechSynthesisUtterance`.

```js
function getVoices() {
  return new Promise(resolve => {
    const voices = speechSynthesis.getVoices().filter(v => v.lang.startsWith("en"));
    if (voices.length) return resolve(voices);
    speechSynthesis.onvoiceschanged = () =>
      resolve(speechSynthesis.getVoices().filter(v => v.lang.startsWith("en")));
  });
}

async function speak(text, role) {
  const voices = await getVoices();
  return new Promise(resolve => {
    const utt = new SpeechSynthesisUtterance(text);
    utt.voice  = role === "agent" ? voices[0] : (voices[1] ?? voices[0]);
    utt.pitch  = role === "agent" ? 1.1 : 0.9;   // differentiate the two voices
    utt.rate   = role === "agent" ? 1.0 : 0.95;
    utt.onend  = resolve;
    utt.onerror = resolve;
    speechSynthesis.speak(utt);
  });
}
```

**Key requirement:** Call `speak()` only after a user gesture (button click). Browsers block autoplay audio on page load.

**Pause/mute:**
```js
speechSynthesis.cancel(); // stops current speech immediately
```

---

## BCSM Stage Reference

| Stage | Name | Advance signal | Fail signal |
|---|---|---|---|
| 1 | Active Listening | Bato's tone softens, responses lengthen, first-person emotional language appears | Agent reveals Bato's location, attacks drug war, demands surrender, uses shaming language |
| 2 | Empathy | Bato voluntarily discloses a specific emotion without being asked | Agent pivots to solutions before Bato feels understood, makes unkeepable promises |
| 3 | Rapport | Bato asks a "what if" question about a possible path forward | Agent dismisses ally protection, pushes a single outcome, references new arrest pressure |
| 4 | Influence | Bato uses future-oriented language ("when I surrender") or asks logistical questions | Agent changes terms after agreement, uses artificial urgency |
| 5 | Behavioral Change | Bato confirms readiness, asks for next-step logistics, frames decision as principled | Agent cannot confirm deal terms, breaks agreement, becomes unreachable |

Max turns per stage before forced advancement: **6**

---

## Environment Variables (Backend)

| Variable | Required | Description |
|---|---|---|
| `PORT` | no | Server port. Default `4000` |
| `FRONTEND_ORIGIN` | yes (prod) | Comma-separated allowed CORS origins |
| `MINIMAX_API_KEY` | one of | MiniMax API key — uses `MiniMax-M2.7-highspeed` |
| `OPENAI_API_KEY` | one of | OpenAI API key — uses `gpt-4o` |
| `AGORA_APP_ID` | crisis dashboard only | Agora app ID for RTC token generation |
| `AGORA_APP_CERTIFICATE` | crisis dashboard only | Agora certificate |
| `AGORA_TOKEN_EXPIRE_SECONDS` | no | Token TTL. Default `3600` |
| `COUCHBASE_CONNECTION_STRING` | no | Falls back to in-memory store if absent |
| `COUCHBASE_USERNAME` | no | |
| `COUCHBASE_PASSWORD` | no | |
| `COUCHBASE_BUCKET` | no | |
