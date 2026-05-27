# Leverage

Leverage is a voice-agent benchmark and crisis-negotiation training demo built around the Behavioral Change Stairway Model (BCSM). It compares agent personas against the same high-stakes negotiation scenario, scores each stage, and stores replayable benchmark runs.

The current demo scenario is a five-stage BCSM negotiation with Bato dela Rosa. Agents must earn progression through active listening, empathy, rapport, influence, and behavioral change instead of jumping straight to pressure or close tactics.

## What is in this repo

| Path | Purpose |
|---|---|
| `frontend/` | Vue 3 + Vite UI for the crisis dashboard and benchmark runner |
| `backend/` | Express + TypeScript API for Agora tokens, game state, benchmark turns, and scoring |
| `personas/` | Sales and negotiation persona prompts used as benchmark agent presets |
| `bato-files-with-objectives/` | Scenario context, Bato agendas, player objectives, and scoring rubrics |
| `persona-history/` | Saved canonical benchmark runs for replay mode |
| `docs/api-integration-guide.md` | Endpoint-level integration notes for frontend or external clients |

## Product Surfaces

### Crisis Dashboard

Route: `/`

The crisis dashboard is the human negotiator console. It joins the Agora voice room, displays the current stress level and stage, and lets the operator manually nudge stress up or down for demo control.

### Agent Benchmark

Route: `/benchmark`

The benchmark runner starts an autonomous agent session, loops through agent move -> Bato reply -> stage evaluation, and produces a final BCSM score out of 15. It supports:

- Six persona agents: Chris Voss, Dale Carnegie, Zig Ziglar, Jordan Belfort, Tony Robbins, and Grant Cardone
- Baseline agents: master negotiator, untrained agent, aggressive negotiator, and custom prompt
- Replay mode for saved canonical persona runs
- Browser speech synthesis for spoken agent/Bato turns

## Architecture

```text
frontend/
  Vue views
    -> /                  CrisisDashboard.vue
    -> /benchmark         AgentBenchmark.vue

backend/
  Express API
    -> Agora token minting
    -> crisis game state
    -> benchmark sessions
    -> LLM turn orchestration
    -> BCSM evaluation

scenario data
  personas/*.md
  bato-files-with-objectives/bato/**
  persona-history/* for saved runs
```

The benchmark server performs up to three LLM calls per live turn:

1. Generate the selected agent's next move.
2. Generate Bato's in-character reply for the current stage.
3. Evaluate whether the stage is held, advanced, or failed.

When a persona has a saved canonical run in `persona-history/`, the backend can serve it in replay mode without re-running the LLM unless `force: true` is passed when starting the session.

## Local Setup

Install dependencies from the repo root:

```bash
npm install
```

Create environment files:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

Minimum backend variables for the benchmark:

```env
PORT=4000
FRONTEND_ORIGIN=http://localhost:5173
OPENAI_API_KEY=your-openai-api-key
```

The backend also accepts `MINIMAX_API_KEY`; when present, MiniMax is used through the OpenAI-compatible client.

Additional variables are needed for optional services:

- Agora voice room: `AGORA_APP_ID`, `AGORA_APP_CERTIFICATE`
- Couchbase persistence: `COUCHBASE_CONNECTION_STRING`, `COUCHBASE_USERNAME`, `COUCHBASE_PASSWORD`, `COUCHBASE_BUCKET`

Without Couchbase configuration, the backend falls back to in-memory state and local `persona-history/` files.

## Running Locally

Start the backend:

```bash
npm run dev:backend
```

Start the frontend in another terminal:

```bash
npm run dev:frontend
```

Open:

- Frontend: `http://localhost:5173`
- Benchmark: `http://localhost:5173/benchmark`
- Backend health check: `http://localhost:4000/health`

Build both workspaces:

```bash
npm run build
```

## Useful Scripts

```bash
npm run dev:backend      # backend server on port 4000
npm run dev:frontend     # Vite dev server on port 5173
npm run build            # TypeScript backend build + Vue frontend build
```

Run all persona benchmarks against the local backend:

```bash
cd backend
bash run-personas.sh
bash run-personas.sh --force
```

The script starts sessions for all six personas, evaluates them, and writes canonical outputs under `persona-history/<persona-id>/`.

## API Summary

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/health` | Backend health check |
| `GET` | `/api/agora/token` | Mint an Agora RTC token for the crisis dashboard |
| `GET` | `/api/game/state` | Fetch crisis dashboard stress/stage state |
| `POST` | `/api/game/state` | Update crisis dashboard stress/stage state |
| `GET` | `/api/benchmark/presets` | List persona and baseline agent presets |
| `POST` | `/api/benchmark/start` | Start a benchmark session |
| `POST` | `/api/benchmark/turn` | Process one agent/Bato/evaluator turn |
| `POST` | `/api/benchmark/evaluate` | Produce final BCSM scoring for a session |

See `docs/api-integration-guide.md` for request and response examples.

## Scoring Model

Each benchmark run evaluates five BCSM stages:

1. Active Listening
2. Empathy
3. Rapport
4. Influence
5. Behavioral Change

Each stage is scored from 0 to 3 for a total score out of 15. The evaluator rewards stage-appropriate technique and penalizes failures such as skipping rapport, applying premature pressure, revealing unsafe information, or making impossible guarantees.

## Team

ODVI - Mors, Loi, Mann, Renz
