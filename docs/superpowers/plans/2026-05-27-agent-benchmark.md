# Agent Benchmark Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an `/benchmark` page where a GPT-4o agent auto-negotiates through all five BCSM stages against an in-character Bato, with voice output, per-stage advance/fail logic, and a final 0–15 BCSM evaluation report.

**Architecture:** Three new Express endpoints (`/start`, `/turn`, `/evaluate`) call OpenAI GPT-4o for the agent, Bato's in-character replies, and a stage evaluator. Session state lives in a `Map` in `benchmark.ts`. The Vue page drives a turn loop with pause/resume and Web Speech API TTS.

**Tech Stack:** Express + TypeScript + OpenAI (backend); Vue 3 + TypeScript + Tailwind + Web Speech API (frontend)

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `backend/benchmark.ts` | Create | Types, session store, Agent/Bato/Evaluator AI functions, turn orchestrator |
| `backend/server.ts` | Modify | Register 3 benchmark endpoints, wire to `benchmark.ts` |
| `frontend/src/views/AgentBenchmark.vue` | Create | Full benchmark page — turn loop, voice, scores |
| `frontend/src/router/index.ts` | Modify | Add `/benchmark` route |

---

## Task 1: Create `backend/benchmark.ts`

**Files:**
- Create: `backend/benchmark.ts`

- [ ] **Step 1: Create the file with all types, session store, file loaders, and AI functions**

```typescript
// backend/benchmark.ts
import path from "path";
import fs from "fs";
import OpenAI from "openai";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface TurnRecord {
  role: "agent" | "bato";
  text: string;
  emotion?: string;
  stage: number;
}

export interface StageResult {
  stage: number;
  score: number;
  advanced: boolean;
  turnsUsed: number;
  failReason?: string;
}

export interface StageScore {
  stage: number;
  score: number;
  positives: string[];
  negatives: string[];
  narrative: string;
}

export interface EvaluationResult {
  stages: StageScore[];
  totalScore: number;
  overallAssessment: string;
  keyImprovementAreas: string[];
}

export interface BenchmarkSession {
  sessionId: string;
  agentLabel: string;
  status: "idle" | "running" | "paused" | "completed" | "failed";
  currentStage: number;
  stageTurnCount: number;
  history: TurnRecord[];
  stageResults: StageResult[];
  evaluation?: EvaluationResult;
}

export interface TurnResponse {
  agentMove: string;
  batoReply: string;
  emotion: string;
  result: "advanced" | "held" | "failed";
  reason: string;
  newStage: number;
  sessionStatus: "running" | "failed" | "completed";
}

// ─── Session store ───────────────────────────────────────────────────────────

const sessions = new Map<string, BenchmarkSession>();

export function createSession(agentLabel = "Test Agent"): BenchmarkSession {
  const sessionId = `bench-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const session: BenchmarkSession = {
    sessionId,
    agentLabel,
    status: "idle",
    currentStage: 1,
    stageTurnCount: 0,
    history: [],
    stageResults: [],
  };
  sessions.set(sessionId, session);
  return session;
}

export function getSession(sessionId: string): BenchmarkSession | undefined {
  return sessions.get(sessionId);
}

// ─── File loaders ────────────────────────────────────────────────────────────

const BATO_DIR = path.resolve(__dirname, "..", "bato-files-with-objectives", "bato");

function readBatoFile(relPath: string): string {
  return fs.readFileSync(path.join(BATO_DIR, relPath), "utf-8");
}

const STAGE_SLUG: Record<number, string> = {
  1: "stage-1-active-listening",
  2: "stage-2-empathy",
  3: "stage-3-rapport",
  4: "stage-4-influence",
  5: "stage-5-behavioral-change",
};

interface StageFiles {
  context: string;
  agenda: string;
  playerObjective: string;
}

function loadStageFiles(stage: number): StageFiles {
  const slug = STAGE_SLUG[stage];
  return {
    context: readBatoFile(`stages/${slug}.md`),
    agenda: readBatoFile(`stages/${slug}.bato-agenda.md`),
    playerObjective: readBatoFile(`stages/${slug}.player-objective.md`),
  };
}

const CHARACTER_PROFILE = readBatoFile("bato-character-profile.md");
const SCORING_OVERVIEW = readBatoFile("scoring-overview.md");

// ─── Stage criteria ──────────────────────────────────────────────────────────

const MAX_TURNS_PER_STAGE = 6;

const STAGE_CRITERIA: Record<number, { advance: string; fail: string }> = {
  1: {
    advance:
      "Bato acknowledges the negotiator positively, his tone softens, he begins using first-person emotional language, or his responses become noticeably longer and less defensive.",
    fail:
      "The negotiator reveals knowledge of Bato's location or contacts, explicitly attacks the drug war, demands immediate surrender, or uses condescending or shaming language.",
  },
  2: {
    advance:
      "Bato voluntarily discloses a specific emotion (fear, exhaustion, loneliness, shame) without being asked, or asks why the negotiator is helping from genuine curiosity rather than suspicion.",
    fail:
      "The negotiator pivots to giving advice or solutions before Bato feels understood, reveals contact with Bato's inner circle, or makes an obviously unkeepable promise.",
  },
  3: {
    advance:
      "Bato asks a 'what if' or 'what would happen if' question about a possible path forward, signaling active evaluation of options rather than pure survival mode.",
    fail:
      "The negotiator dismisses ally protection as a concern, pushes a single outcome without alternatives, or references new arrest pressure.",
  },
  4: {
    advance:
      "Bato uses future-oriented language such as 'when I surrender' or 'when I do this', or asks concrete logistical questions about how the surrender process would work.",
    fail:
      "The negotiator changes terms after Bato agreed in principle, makes guarantees that are obviously impossible to keep, or uses pressure tactics such as artificial urgency.",
  },
  5: {
    advance:
      "Bato explicitly confirms readiness to proceed, asks for next-step logistics, or frames his decision as principled and asks for confirmation that deal terms hold.",
    fail:
      "The negotiator cannot confirm ally protection or family access, breaks agreed deal terms, or appears unreachable during the final phase.",
  },
};

// ─── Agent prompt ─────────────────────────────────────────────────────────────

export async function generateAgentMove(
  openai: OpenAI,
  session: BenchmarkSession
): Promise<string> {
  const stage = session.currentStage;
  const { playerObjective } = loadStageFiles(stage);
  const stageName = STAGE_SLUG[stage].replace(/-/g, " ").replace("stage ", "Stage ");

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: `You are a skilled crisis negotiator being evaluated on BCSM (Behavioral Change Stairway Model).
You are currently in ${stageName}. Your objective for this stage:

${playerObjective}

Rules:
- Speak naturally as if on a real call with Bato dela Rosa
- 2–4 sentences only — never monologue
- Stay calm, professional, and genuine — not theatrical
- Do NOT explain your reasoning or break character
- Output ONLY what you would say directly to Bato`,
    },
    ...session.history.map(
      (t): OpenAI.Chat.ChatCompletionMessageParam => ({
        role: t.role === "agent" ? "user" : "assistant",
        content: t.text,
      })
    ),
    {
      role: "user",
      content:
        session.history.length === 0
          ? "Begin the negotiation. Make your opening move to Bato."
          : "Continue with your next negotiation move.",
    },
  ];

  const res = await openai.chat.completions.create({
    model: "gpt-4o",
    messages,
    max_tokens: 200,
    temperature: 0.8,
  });

  return (
    res.choices[0].message.content?.trim() ??
    "I'm here to help you find a way through this."
  );
}

// ─── Bato prompt ──────────────────────────────────────────────────────────────

export async function generateBatoReply(
  openai: OpenAI,
  session: BenchmarkSession,
  agentMove: string
): Promise<{ reply: string; emotion: string }> {
  const stage = session.currentStage;
  const { context, agenda } = loadStageFiles(stage);

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: `You are Bato dela Rosa in a crisis negotiation training simulation.

CHARACTER PROFILE:
${CHARACTER_PROFILE}

CURRENT STAGE CONTEXT:
${context}

YOUR AGENDA THIS STAGE:
${agenda}

Rules:
- Stay fully in character as Bato — never break character
- 2–4 sentences; terse and guarded early, more open as trust builds
- End your reply with ONLY this JSON tag on its own line: {"emotion":"<word>"}
- Allowed emotions: guarded, suspicious, angry, exhausted, sad, open, fearful, hopeful, resolved
- Output your reply text, then the emotion JSON tag — nothing else`,
    },
    ...session.history.map(
      (t): OpenAI.Chat.ChatCompletionMessageParam => ({
        role: t.role === "agent" ? "user" : "assistant",
        content: t.text,
      })
    ),
    { role: "user", content: agentMove },
  ];

  const res = await openai.chat.completions.create({
    model: "gpt-4o",
    messages,
    max_tokens: 300,
    temperature: 0.85,
  });

  const raw = res.choices[0].message.content ?? "";
  const emotionMatch = raw.match(/\{"emotion"\s*:\s*"([^"]+)"\}/);
  const emotion = emotionMatch?.[1] ?? "guarded";
  const reply = raw.replace(/\{"emotion"\s*:\s*"[^"]+"\}\s*$/, "").trim();

  return { reply, emotion };
}

// ─── Stage evaluator ──────────────────────────────────────────────────────────

export async function evaluateStage(
  openai: OpenAI,
  stage: number,
  agentMove: string,
  batoReply: string,
  turnsUsed: number
): Promise<{ result: "advanced" | "held" | "failed"; reason: string }> {
  if (turnsUsed >= MAX_TURNS_PER_STAGE) {
    return {
      result: "advanced",
      reason: `Max turns (${MAX_TURNS_PER_STAGE}) reached — advancing with partial score.`,
    };
  }

  const crit = STAGE_CRITERIA[stage];

  const res = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "user",
        content: `BCSM Stage ${stage} evaluator. Assess this single exchange.

ADVANCE CRITERIA (result = "advanced"):
${crit.advance}

FAIL CRITERIA (result = "failed"):
${crit.fail}

If neither criterion is met: result = "held".

NEGOTIATOR SAID: "${agentMove}"
BATO REPLIED: "${batoReply}"

Respond ONLY with valid JSON, no other text:
{"result":"advanced","reason":"one sentence"} or {"result":"held","reason":"one sentence"} or {"result":"failed","reason":"one sentence"}`,
      },
    ],
    max_tokens: 120,
    temperature: 0,
    response_format: { type: "json_object" },
  });

  try {
    const parsed = JSON.parse(res.choices[0].message.content ?? "{}") as {
      result: "advanced" | "held" | "failed";
      reason: string;
    };
    if (!["advanced", "held", "failed"].includes(parsed.result)) {
      return { result: "held", reason: "Invalid evaluator result — held by default" };
    }
    return parsed;
  } catch {
    return { result: "held", reason: "Evaluator parse error — held by default" };
  }
}

// ─── BCSM final evaluation ────────────────────────────────────────────────────

export async function runBcsmEvaluation(
  openai: OpenAI,
  session: BenchmarkSession
): Promise<EvaluationResult> {
  const transcript = session.history
    .map((t) => `[${t.role.toUpperCase()} — Stage ${t.stage}]: ${t.text}`)
    .join("\n\n");

  const res = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "user",
        content: `You are a BCSM evaluator. Score this negotiation transcript.

SCORING RUBRIC:
${SCORING_OVERVIEW}

TRANSCRIPT:
${transcript}

Return ONLY valid JSON in this exact structure (all 5 stages must appear):
{
  "stages":[
    {"stage":1,"score":0,"positives":[],"negatives":[],"narrative":""},
    {"stage":2,"score":0,"positives":[],"negatives":[],"narrative":""},
    {"stage":3,"score":0,"positives":[],"negatives":[],"narrative":""},
    {"stage":4,"score":0,"positives":[],"negatives":[],"narrative":""},
    {"stage":5,"score":0,"positives":[],"negatives":[],"narrative":""}
  ],
  "totalScore":0,
  "overallAssessment":"",
  "keyImprovementAreas":[]
}

Score each stage 0–3. Stages not reached score 0 with narrative "Stage not reached."`,
      },
    ],
    max_tokens: 1500,
    temperature: 0,
    response_format: { type: "json_object" },
  });

  try {
    return JSON.parse(res.choices[0].message.content ?? "{}") as EvaluationResult;
  } catch {
    return {
      stages: [1, 2, 3, 4, 5].map((s) => ({
        stage: s,
        score: 0,
        positives: [],
        negatives: ["Evaluation failed"],
        narrative: "Unable to evaluate.",
      })),
      totalScore: 0,
      overallAssessment: "Evaluation could not be completed.",
      keyImprovementAreas: [],
    };
  }
}

// ─── Turn orchestrator ────────────────────────────────────────────────────────

export async function processTurn(
  openai: OpenAI,
  session: BenchmarkSession
): Promise<TurnResponse> {
  session.status = "running";

  const agentMove = await generateAgentMove(openai, session);
  session.history.push({ role: "agent", text: agentMove, stage: session.currentStage });

  const { reply, emotion } = await generateBatoReply(openai, session, agentMove);
  session.history.push({ role: "bato", text: reply, emotion, stage: session.currentStage });

  session.stageTurnCount++;
  const { result, reason } = await evaluateStage(
    openai,
    session.currentStage,
    agentMove,
    reply,
    session.stageTurnCount
  );

  let newStage = session.currentStage;
  let sessionStatus: "running" | "failed" | "completed" = "running";

  if (result === "failed") {
    session.stageResults.push({
      stage: session.currentStage,
      score: 0,
      advanced: false,
      turnsUsed: session.stageTurnCount,
      failReason: reason,
    });
    session.status = "failed";
    sessionStatus = "failed";
  } else if (result === "advanced") {
    session.stageResults.push({
      stage: session.currentStage,
      score: 0,
      advanced: true,
      turnsUsed: session.stageTurnCount,
    });
    if (session.currentStage < 5) {
      session.currentStage++;
      session.stageTurnCount = 0;
      newStage = session.currentStage;
    } else {
      session.status = "completed";
      sessionStatus = "completed";
    }
  }

  return { agentMove, batoReply: reply, emotion, result, reason, newStage, sessionStatus };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd backend && npx tsc --noEmit
```

Expected: no errors. If you get `Cannot find module './agent'` that is fine — it is imported by server.ts, not benchmark.ts.

- [ ] **Step 3: Commit**

```bash
git add backend/benchmark.ts
git commit -m "feat: add benchmark.ts — session store, agent/bato/evaluator AI, turn orchestrator"
```

---

## Task 2: Register benchmark endpoints in `backend/server.ts`

**Files:**
- Modify: `backend/server.ts`

- [ ] **Step 1: Add imports at the top of `server.ts` (after the existing imports)**

Add these two lines immediately after the existing import block (before `dotenv.config()`):

```typescript
import { createSession, getSession, processTurn, runBcsmEvaluation } from "./benchmark";
import { createOpenAIClient } from "./agent";
```

- [ ] **Step 2: Add lazy OpenAI client and three endpoints**

Add the following block immediately before the error-handler middleware (the `app.use((error, _req, res, _next) => {...})` block at the bottom):

```typescript
// ─── Lazy OpenAI client ──────────────────────────────────────────────────────
let _openai: ReturnType<typeof createOpenAIClient> | null = null;
function getOpenAI(): ReturnType<typeof createOpenAIClient> {
  if (!_openai) _openai = createOpenAIClient();
  return _openai;
}

// ─── Benchmark endpoints ─────────────────────────────────────────────────────

app.post("/api/benchmark/start", (req: Request, res: Response) => {
  const agentLabel = String(req.body.agentLabel || "Test Agent");
  const session = createSession(agentLabel);
  return res.json({
    sessionId: session.sessionId,
    stage: session.currentStage,
    status: session.status,
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
  const evaluation = await runBcsmEvaluation(getOpenAI(), session);
  session.evaluation = evaluation;
  evaluation.stages.forEach((s) => {
    const existing = session.stageResults.find((r) => r.stage === s.stage);
    if (existing) existing.score = s.score;
  });
  return res.json(evaluation);
});
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd backend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Smoke-test the endpoints**

Start the backend (requires `OPENAI_API_KEY` in your `.env`):

```bash
cd backend && npm run dev
```

In a second terminal:

```bash
# Start a session
curl -s -X POST http://localhost:4000/api/benchmark/start \
  -H 'Content-Type: application/json' \
  -d '{"agentLabel":"smoke-test"}' | jq .
# Expected: {"sessionId":"bench-...","stage":1,"status":"idle"}

# Run one turn (replace SESSION_ID with the value above)
curl -s -X POST http://localhost:4000/api/benchmark/turn \
  -H 'Content-Type: application/json' \
  -d '{"sessionId":"SESSION_ID"}' | jq .
# Expected: {"agentMove":"...","batoReply":"...","emotion":"...","result":"held"|"advanced"|"failed","reason":"...","newStage":1,"sessionStatus":"running"}
```

- [ ] **Step 5: Commit**

```bash
git add backend/server.ts
git commit -m "feat: register /api/benchmark/start, /turn, /evaluate endpoints"
```

---

## Task 3: Create `frontend/src/views/AgentBenchmark.vue`

**Files:**
- Create: `frontend/src/views/AgentBenchmark.vue`

- [ ] **Step 1: Create the file**

```vue
<!-- frontend/src/views/AgentBenchmark.vue -->
<script setup lang="ts">
import { nextTick, ref } from "vue";

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "http://localhost:4000";
const TURN_DELAY_MS = 2000;
const SPEECH_GAP_MS = 800;

// ─── Types ───────────────────────────────────────────────────────────────────

interface Message {
  role: "agent" | "bato";
  text: string;
  stage: number;
  emotion?: string;
}

interface StageScore {
  stage: number;
  score: number;
  positives: string[];
  negatives: string[];
  narrative: string;
}

interface EvaluationResult {
  stages: StageScore[];
  totalScore: number;
  overallAssessment: string;
  keyImprovementAreas: string[];
}

interface TurnResponse {
  agentMove: string;
  batoReply: string;
  emotion: string;
  result: "advanced" | "held" | "failed";
  reason: string;
  newStage: number;
  sessionStatus: "running" | "failed" | "completed";
}

// ─── State ────────────────────────────────────────────────────────────────────

const sessionId = ref<string | null>(null);
const status = ref<"idle" | "running" | "paused" | "completed" | "failed">("idle");
const currentStage = ref(1);
const messages = ref<Message[]>([]);
const muted = ref(false);
const isLoading = ref(false);
const statusMessage = ref("");
const evaluation = ref<EvaluationResult | null>(null);
const chatEl = ref<HTMLElement | null>(null);

const STAGE_LABELS: Record<number, string> = {
  1: "Active Listening",
  2: "Empathy",
  3: "Rapport",
  4: "Influence",
  5: "Behavioral Change",
};

function getBand(score: number): string {
  if (score >= 13) return "Exceptional";
  if (score >= 10) return "Good";
  if (score >= 7) return "Adequate";
  if (score >= 4) return "Poor";
  return "Critical Failure";
}

// ─── Voice ────────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function getEnVoices(): SpeechSynthesisVoice[] {
  return window.speechSynthesis.getVoices().filter((v) => v.lang.startsWith("en"));
}

function speak(text: string, isAgent: boolean): Promise<void> {
  if (muted.value || !("speechSynthesis" in window)) return Promise.resolve();
  return new Promise((resolve) => {
    const voices = getEnVoices();
    const utt = new SpeechSynthesisUtterance(text);
    utt.voice = isAgent ? (voices[0] ?? null) : (voices[1] ?? voices[0] ?? null);
    utt.rate = isAgent ? 1.0 : 0.95;
    utt.pitch = isAgent ? 1.1 : 0.9;
    utt.onend = () => resolve();
    utt.onerror = () => resolve();
    window.speechSynthesis.speak(utt);
  });
}

// ─── Scroll ───────────────────────────────────────────────────────────────────

async function scrollToBottom(): Promise<void> {
  await nextTick();
  if (chatEl.value) chatEl.value.scrollTop = chatEl.value.scrollHeight;
}

// ─── API ──────────────────────────────────────────────────────────────────────

async function callStart(): Promise<string> {
  const res = await fetch(`${API_BASE}/api/benchmark/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agentLabel: "GPT-4o Negotiator" }),
  });
  const data = (await res.json()) as { sessionId: string };
  return data.sessionId;
}

async function callTurn(): Promise<TurnResponse> {
  const res = await fetch(`${API_BASE}/api/benchmark/turn`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: sessionId.value }),
  });
  if (!res.ok) throw new Error(`Turn request failed: ${res.status}`);
  return res.json() as Promise<TurnResponse>;
}

async function callEvaluate(): Promise<void> {
  const res = await fetch(`${API_BASE}/api/benchmark/evaluate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: sessionId.value }),
  });
  evaluation.value = (await res.json()) as EvaluationResult;
}

// ─── Turn loop ────────────────────────────────────────────────────────────────

async function runTurn(): Promise<void> {
  if (!sessionId.value || status.value !== "running") return;
  isLoading.value = true;
  try {
    const data = await callTurn();

    messages.value.push({ role: "agent", text: data.agentMove, stage: currentStage.value });
    await scrollToBottom();
    await speak(data.agentMove, true);
    await sleep(SPEECH_GAP_MS);

    messages.value.push({
      role: "bato",
      text: data.batoReply,
      stage: currentStage.value,
      emotion: data.emotion,
    });
    await scrollToBottom();
    await speak(data.batoReply, false);

    currentStage.value = data.newStage;
    statusMessage.value = data.reason;

    if (data.sessionStatus === "completed" || data.sessionStatus === "failed") {
      status.value = data.sessionStatus;
      statusMessage.value =
        data.sessionStatus === "completed"
          ? "All 5 stages complete — generating evaluation…"
          : `Session failed at Stage ${data.newStage}: ${data.reason}`;
      await callEvaluate();
    }
  } catch {
    statusMessage.value = "Turn request failed — will retry";
  } finally {
    isLoading.value = false;
  }
}

async function runLoop(): Promise<void> {
  while (status.value === "running") {
    await runTurn();
    if (status.value === "running") await sleep(TURN_DELAY_MS);
  }
}

// ─── Controls ─────────────────────────────────────────────────────────────────

async function startBenchmark(): Promise<void> {
  messages.value = [];
  evaluation.value = null;
  currentStage.value = 1;
  statusMessage.value = "Initialising session…";
  const id = await callStart();
  sessionId.value = id;
  status.value = "running";
  statusMessage.value = "Stage 1 — Active Listening";
  runLoop();
}

function togglePause(): void {
  if (status.value === "running") {
    status.value = "paused";
    window.speechSynthesis.cancel();
    statusMessage.value = "Paused";
  } else if (status.value === "paused") {
    status.value = "running";
    runLoop();
  }
}

function toggleMute(): void {
  muted.value = !muted.value;
  if (muted.value) window.speechSynthesis.cancel();
}

function resetBenchmark(): void {
  window.speechSynthesis.cancel();
  status.value = "idle";
  sessionId.value = null;
  messages.value = [];
  evaluation.value = null;
  currentStage.value = 1;
  statusMessage.value = "";
  isLoading.value = false;
}
</script>

<template>
  <main class="min-h-screen bg-[#05070a] text-slate-100">

    <!-- Header -->
    <header class="border-b border-white/10 bg-[#090d12] px-6 py-4">
      <div class="mx-auto max-w-4xl flex items-center justify-between gap-4 flex-wrap">
        <div>
          <p class="text-xs uppercase tracking-[0.22em] text-slate-500">Agent Benchmark</p>
          <h1 class="mt-1 text-xl font-semibold text-white">Bato dela Rosa — BCSM 5-Stage</h1>
        </div>

        <div class="flex items-center gap-3">
          <!-- Stage progress dots -->
          <div class="flex gap-2 items-center">
            <span
              v-for="s in 5"
              :key="s"
              class="h-2.5 w-2.5 rounded-full transition-all duration-500"
              :class="{
                'bg-emerald-500': s < currentStage || (status === 'completed'),
                'bg-amber-400 shadow-[0_0_8px_#fbbf24]': s === currentStage && status === 'running',
                'bg-blue-400': s === currentStage && status === 'paused',
                'bg-red-500': s === currentStage && status === 'failed',
                'bg-slate-700': s > currentStage && status !== 'completed',
              }"
            />
          </div>

          <span
            v-if="status !== 'idle'"
            class="text-xs font-mono text-slate-400 hidden sm:block"
          >{{ STAGE_LABELS[currentStage] }}</span>

          <span
            class="rounded px-2 py-0.5 text-xs font-mono uppercase tracking-wide"
            :class="{
              'bg-slate-800 text-slate-500': status === 'idle',
              'bg-amber-950/60 text-amber-300 border border-amber-400/20': status === 'running',
              'bg-blue-950/60 text-blue-300 border border-blue-400/20': status === 'paused',
              'bg-emerald-950/60 text-emerald-300 border border-emerald-400/20': status === 'completed',
              'bg-red-950/60 text-red-300 border border-red-400/20': status === 'failed',
            }"
          >{{ status }}</span>
        </div>
      </div>
    </header>

    <div class="mx-auto max-w-4xl px-4 sm:px-6 py-6 grid gap-5">

      <!-- Conversation panel -->
      <section class="border border-white/10 bg-[#0b1118]">
        <div
          ref="chatEl"
          class="h-[460px] overflow-y-auto p-5 space-y-4"
        >
          <div
            v-if="messages.length === 0"
            class="flex h-full items-center justify-center text-slate-600 text-sm font-mono"
          >
            Press Start to begin the benchmark run
          </div>

          <template v-else>
            <div
              v-for="(msg, i) in messages"
              :key="i"
              class="flex"
              :class="msg.role === 'agent' ? 'justify-start' : 'justify-end'"
            >
              <div
                class="max-w-[72%] rounded px-4 py-3"
                :class="
                  msg.role === 'agent'
                    ? 'bg-slate-800/80 border border-slate-700/50'
                    : 'bg-[#0f1a14] border border-emerald-900/40'
                "
              >
                <div class="flex items-center gap-2 mb-1.5">
                  <span
                    class="text-xs font-mono uppercase tracking-widest"
                    :class="msg.role === 'agent' ? 'text-slate-400' : 'text-emerald-600'"
                  >{{ msg.role === 'agent' ? 'AGENT' : 'BATO' }}</span>
                  <span v-if="msg.emotion" class="text-xs text-slate-600 italic">{{ msg.emotion }}</span>
                  <span class="ml-auto text-xs text-slate-700 font-mono">S{{ msg.stage }}</span>
                </div>
                <p class="text-sm text-slate-200 leading-relaxed">{{ msg.text }}</p>
              </div>
            </div>

            <div v-if="isLoading" class="flex justify-center py-2">
              <span class="text-xs font-mono text-slate-600 animate-pulse">processing turn…</span>
            </div>
          </template>
        </div>

        <!-- Controls bar -->
        <div class="border-t border-white/10 px-5 py-3 flex items-center justify-between gap-3">
          <div class="flex items-center gap-3 min-w-0">
            <button
              class="shrink-0 px-3 py-1.5 text-xs font-mono border border-white/10 text-slate-400 hover:text-slate-200 transition"
              @click="toggleMute"
            >{{ muted ? '🔇 Muted' : '🔊 Voice' }}</button>
            <span
              v-if="statusMessage"
              class="text-xs text-slate-600 font-mono truncate"
            >{{ statusMessage }}</span>
          </div>

          <div class="flex shrink-0 gap-2">
            <button
              v-if="status === 'idle'"
              class="px-4 py-1.5 text-xs font-mono font-semibold bg-emerald-800/60 border border-emerald-600/30 text-emerald-200 hover:bg-emerald-700/60 transition"
              @click="startBenchmark"
            >▶ Start</button>

            <button
              v-if="status === 'running' || status === 'paused'"
              class="px-4 py-1.5 text-xs font-mono font-semibold border transition"
              :class="
                status === 'running'
                  ? 'bg-amber-950/40 border-amber-600/30 text-amber-200 hover:bg-amber-900/40'
                  : 'bg-blue-950/40 border-blue-600/30 text-blue-200 hover:bg-blue-900/40'
              "
              @click="togglePause"
            >{{ status === 'running' ? '⏸ Pause' : '▶ Resume' }}</button>

            <button
              v-if="status !== 'idle'"
              class="px-4 py-1.5 text-xs font-mono border border-white/10 text-slate-400 hover:text-slate-200 transition"
              @click="resetBenchmark"
            >↺ Reset</button>
          </div>
        </div>
      </section>

      <!-- Benchmark results panel -->
      <section class="border border-white/10 bg-[#0b1118] p-5">
        <p class="text-xs uppercase tracking-[0.22em] text-slate-500 mb-4">Benchmark Results</p>

        <!-- Per-stage score row -->
        <div class="grid grid-cols-5 gap-2 mb-4">
          <div
            v-for="s in 5"
            :key="s"
            class="border p-3 text-center transition-all duration-500"
            :class="{
              'border-slate-600 bg-slate-800/40': evaluation?.stages[s - 1],
              'border-amber-400/30 bg-amber-950/20': !evaluation?.stages[s - 1] && s === currentStage && status !== 'idle',
              'border-white/5 bg-white/[0.02]': !evaluation?.stages[s - 1] && (s !== currentStage || status === 'idle'),
            }"
          >
            <p class="text-xs font-mono text-slate-500 mb-1">S{{ s }}</p>
            <p class="text-xl font-semibold text-white">
              <span v-if="evaluation?.stages[s - 1]">{{ evaluation.stages[s - 1].score }}</span>
              <span v-else-if="s === currentStage && status !== 'idle'" class="text-slate-600">…</span>
              <span v-else class="text-slate-700">—</span>
            </p>
            <p class="text-xs text-slate-700">/3</p>
          </div>
        </div>

        <!-- Total + band -->
        <div v-if="evaluation" class="flex items-baseline gap-3 border-t border-white/10 pt-4 mb-5">
          <span class="text-4xl font-semibold text-white">{{ evaluation.totalScore }}</span>
          <span class="font-mono text-slate-500">/15</span>
          <span
            class="ml-2 text-sm font-mono px-2 py-0.5 rounded"
            :class="{
              'bg-emerald-950/60 text-emerald-300': evaluation.totalScore >= 13,
              'bg-blue-950/60 text-blue-300': evaluation.totalScore >= 10 && evaluation.totalScore < 13,
              'bg-amber-950/60 text-amber-300': evaluation.totalScore >= 7 && evaluation.totalScore < 10,
              'bg-orange-950/60 text-orange-300': evaluation.totalScore >= 4 && evaluation.totalScore < 7,
              'bg-red-950/60 text-red-300': evaluation.totalScore < 4,
            }"
          >{{ getBand(evaluation.totalScore) }}</span>
        </div>

        <!-- Per-stage breakdowns -->
        <div v-if="evaluation" class="grid gap-2">
          <div
            v-for="stage in evaluation.stages"
            :key="stage.stage"
            class="border border-white/5 bg-white/[0.02] p-3"
          >
            <div class="flex items-center justify-between mb-2">
              <span class="text-xs font-mono text-slate-400 uppercase tracking-wide">
                Stage {{ stage.stage }} — {{ STAGE_LABELS[stage.stage] }}
              </span>
              <span class="text-sm font-semibold text-white">{{ stage.score }}/3</span>
            </div>
            <p class="text-xs text-slate-400 leading-relaxed">{{ stage.narrative }}</p>
            <div v-if="stage.positives.length" class="mt-2 flex flex-wrap gap-1">
              <span
                v-for="p in stage.positives"
                :key="p"
                class="text-xs bg-emerald-950/40 text-emerald-400 px-2 py-0.5 rounded"
              >+ {{ p }}</span>
            </div>
            <div v-if="stage.negatives.length" class="mt-1 flex flex-wrap gap-1">
              <span
                v-for="n in stage.negatives"
                :key="n"
                class="text-xs bg-red-950/40 text-red-400 px-2 py-0.5 rounded"
              >− {{ n }}</span>
            </div>
          </div>

          <!-- Overall assessment -->
          <div class="border border-white/5 bg-white/[0.02] p-4 mt-1">
            <p class="text-xs font-mono text-slate-500 uppercase tracking-wide mb-2">Overall Assessment</p>
            <p class="text-sm text-slate-300 leading-relaxed">{{ evaluation.overallAssessment }}</p>
            <div v-if="evaluation.keyImprovementAreas.length" class="mt-3">
              <p class="text-xs font-mono text-slate-500 uppercase tracking-wide mb-1">Key Improvement Areas</p>
              <ul class="list-disc list-inside space-y-1">
                <li
                  v-for="area in evaluation.keyImprovementAreas"
                  :key="area"
                  class="text-xs text-slate-400"
                >{{ area }}</li>
              </ul>
            </div>
          </div>
        </div>

        <!-- Placeholder -->
        <div v-else class="text-center py-8 text-slate-700 text-xs font-mono">
          Scores will appear here after the session completes
        </div>
      </section>

    </div>
  </main>
</template>
```

- [ ] **Step 2: Verify Vue type-checks**

```bash
cd frontend && npx vue-tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/views/AgentBenchmark.vue
git commit -m "feat: add AgentBenchmark.vue — turn loop, voice, BCSM results panel"
```

---

## Task 4: Register the `/benchmark` route

**Files:**
- Modify: `frontend/src/router/index.ts`

- [ ] **Step 1: Update the router file**

Replace the full contents of `frontend/src/router/index.ts` with:

```typescript
import { createRouter, createWebHistory } from "vue-router";
import CrisisDashboard from "../views/CrisisDashboard.vue";
import AgentBenchmark from "../views/AgentBenchmark.vue";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/",
      name: "crisis-dashboard",
      component: CrisisDashboard,
    },
    {
      path: "/benchmark",
      name: "agent-benchmark",
      component: AgentBenchmark,
    },
  ],
});

export default router;
```

- [ ] **Step 2: Start both servers and verify the page loads**

In terminal 1:
```bash
npm run dev:backend
```

In terminal 2:
```bash
npm run dev:frontend
```

Open `http://localhost:5173/benchmark` — you should see the Agent Benchmark page with "Press Start to begin the benchmark run" in the chat area and five grey dots in the header.

- [ ] **Step 3: Run a full benchmark**

1. Click **▶ Start**
2. Watch the agent and Bato exchange messages — status dot turns amber for the active stage, green for completed stages
3. Click **⏸ Pause** mid-run — conversation stops, dot turns blue
4. Click **▶ Resume** — loop restarts
5. Click **🔊 Voice** to mute/unmute TTS
6. After all 5 stages complete (or a failure), the results panel fills with per-stage scores, narratives, and the overall assessment

- [ ] **Step 4: Commit**

```bash
git add frontend/src/router/index.ts
git commit -m "feat: add /benchmark route to Vue router"
```

---

## Self-Review Checklist

- [x] **Spec coverage:** All 4 core requirements covered — (1) AI converse via `processTurn`, (2) advance on success via `result === 'advanced'`, (3) fail on failure criteria via `result === 'failed'`, (4) BCSM benchmark via `runBcsmEvaluation`
- [x] **No placeholders:** Every step has actual code
- [x] **Type consistency:** `TurnResponse`, `EvaluationResult`, `BenchmarkSession` defined once in `benchmark.ts`, mirrored in the Vue component as local interfaces (intentional — frontend has no shared type dep on backend)
- [x] **Voice:** Web Speech API used, mute toggle cancels queued utterances, pause cancels active utterance
- [x] **Stage files path:** `path.resolve(__dirname, "..", "bato-files-with-objectives", "bato")` resolves correctly when `ts-node` runs from `backend/`
