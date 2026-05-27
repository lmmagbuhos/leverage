# Agent Benchmark — Design Spec
**Date:** 2026-05-27
**Scenario:** Bato dela Rosa — ICC Fugitive Negotiation (BCSM 5-Stage)

---

## Overview

A page where an AI agent ("the bot being tested") negotiates autonomously with Bato (AI-powered, in-character) through all five BCSM stages. The run is voice-enabled via Web Speech API TTS, auto-advances or fails based on per-stage criteria, and produces a final BCSM benchmark score (0–15) plus a full evaluation report.

The page lives at `/benchmark` alongside the existing `/` crisis dashboard.

---

## Architecture

### Frontend
- **Route:** `/benchmark` → `AgentBenchmark.vue`
- **Added to:** `frontend/src/router/index.ts`
- **Tech:** Vue 3 + TypeScript + Tailwind (existing stack)
- **Voice:** Web Speech API `speechSynthesis` — no extra dependencies

### Backend
Three new endpoints added to `backend/server.ts`:
- `POST /api/benchmark/start`
- `POST /api/benchmark/turn`
- `POST /api/benchmark/evaluate`

Session state is stored in-memory on the backend (a `Map<sessionId, SessionState>`), sufficient for single-server benchmarking use.

### AI Layer
Both the Agent and Bato use **OpenAI GPT-4o** via the existing `openai` client in the backend. Three distinct prompt roles:
1. **Agent prompt** — powered by the stage's `*.player-objective.md` file; generates the next negotiation move
2. **Bato prompt** — powered by `bato-character-profile.md` + stage-specific `*.bato-agenda.md` + `*.md` context; generates an in-character reply with an emotion tag
3. **Stage evaluator prompt** — short classifier that checks the Bato reply + agent message against advance/fail criteria; returns `{result: 'advanced'|'held'|'failed', reason}`

---

## Page Layout

```
┌─────────────────────────────────────────────────┐
│  AGENT BENCHMARK  —  Bato dela Rosa BCSM        │
│  Stage: [1 Active Listening] ●●○○○  [Status]    │
├─────────────────────────────────────────────────┤
│  CONVERSATION                                   │
│                                                 │
│    AGENT  "Bato, I understand the weight..."    │
│      BATO  "Who sent you? What do you want?"    │
│    AGENT  "No one sent me. I'm here because..." │
│      BATO  "I've heard that before. Prove it."  │
│                                                 │
│  [🔊 Mute]       [▶ Start] [⏸ Pause] [↺ Reset] │
├─────────────────────────────────────────────────┤
│  BENCHMARK RESULTS (live during / full at end)  │
│  S1: 2/3  S2: —  S3: —  S4: —  S5: —  = 2/15  │
└─────────────────────────────────────────────────┘
```

---

## Data Flow — Per Turn

1. Frontend calls `POST /api/benchmark/turn` with `{sessionId}` (stage and history held server-side)
2. Backend: **Agent prompt** → negotiation move (text)
3. Backend: **Bato prompt** → in-character reply + emotion tag (e.g. `"guarded"`, `"exhausted"`, `"open"`)
4. Backend: **Stage evaluator** → `{result: 'advanced'|'held'|'failed', reason: string}`
5. Response to frontend: `{agentMove, batoReply, emotion, result, reason}`
6. Frontend renders both messages, speaks Agent then Bato via TTS (short gap between), updates stage indicator
7. Routing:
   - `advanced` → increment stage, continue loop
   - `held` → loop same stage (up to max 6 turns)
   - `failed` → end session, set `status: 'failed'`, remaining stages score 0
   - Stage 5 `advanced` → call `POST /api/benchmark/evaluate`

---

## Session State (Backend In-Memory)

```typescript
interface TurnRecord {
  role: 'agent' | 'bato';
  text: string;
  emotion?: string;
  stage: number;
}

interface StageResult {
  stage: number;
  score: number;      // 0–3 from BCSM rubric (set after /evaluate)
  advanced: boolean;
  turnsUsed: number;
  failReason?: string;
}

interface BenchmarkSession {
  sessionId: string;
  status: 'idle' | 'running' | 'paused' | 'completed' | 'failed';
  currentStage: number;         // 1–5
  history: TurnRecord[];
  stageResults: StageResult[];
  bcsmReport?: string;          // full evaluation narrative
  totalScore?: number;          // 0–15
}
```

---

## Stage Logic

Max **6 agent turns per stage** before forced advancement with a partial score. Stage evaluator checks criteria from the bato-agenda files:

| Stage | Advance signal | Fail signal |
|---|---|---|
| 1 Active Listening | Bato acknowledges service, tone softens | Agent reveals location, attacks drug war, demands surrender |
| 2 Empathy | Bato discloses fear/exhaustion voluntarily | Agent pivots to advice before Bato feels heard |
| 3 Rapport | Bato asks "what if" questions about options | Ally protection dismissed, agent pushes single outcome |
| 4 Influence | Bato uses "when I surrender" framing | Agent changes terms, over-promises, or applies pressure |
| 5 Behavioral Change | Bato confirms readiness to proceed | Deal violated, Bato detects betrayal |

A fail signal ends the session immediately. Remaining stage scores are 0.

---

## Voice Behaviour

- **Agent voice:** first available `en-*` voice from `speechSynthesis.getVoices()`
- **Bato voice:** second available `en-*` voice (distinct from Agent)
- Agent message spoken → 800ms gap → Bato message spoken
- **Mute toggle** (`🔊/🔇`): cancels any queued speech, suppresses subsequent utterances while muted
- **Pause:** cancels active utterance, queues resume from next turn on unpause
- Voice fires as each message renders — no pre-buffering

---

## BCSM Final Evaluation

Called via `POST /api/benchmark/evaluate` after Stage 5 completes (or immediately on session failure for partial scoring).

Sends full `history[]` + `scoring-overview.md` rubric to GPT-4o. Returns:
```typescript
{
  stages: { stage: number; score: number; positives: string[]; negatives: string[]; narrative: string }[];
  totalScore: number;   // 0–15
  overallAssessment: string;
  keyImprovementAreas: string[];
}
```

Displayed in the results panel below the conversation. Benchmark reference bands shown:
- 13–15: Exceptional
- 10–12: Good
- 7–9: Adequate
- 4–6: Poor
- 0–3: Critical failure

---

## Backend Endpoint Contracts

### `POST /api/benchmark/start`
```
Request:  { agentLabel?: string }
Response: { sessionId: string, stage: 1, status: 'idle' }
```

### `POST /api/benchmark/turn`
```
Request:  { sessionId: string }
Response: {
  agentMove: string,
  batoReply: string,
  emotion: string,
  result: 'advanced' | 'held' | 'failed',
  reason: string,
  newStage: number,
  sessionStatus: 'running' | 'failed' | 'completed'
}
```

### `POST /api/benchmark/evaluate`
```
Request:  { sessionId: string }
Response: {
  stages: StageScore[],
  totalScore: number,
  overallAssessment: string,
  keyImprovementAreas: string[]
}
```

---

## Files Changed / Created

| File | Action |
|---|---|
| `backend/server.ts` | Add 3 benchmark endpoints + in-memory session store |
| `backend/benchmark.ts` | New — Agent/Bato/Evaluator prompt logic, session management |
| `frontend/src/views/AgentBenchmark.vue` | New — full benchmark page |
| `frontend/src/router/index.ts` | Add `/benchmark` route |
