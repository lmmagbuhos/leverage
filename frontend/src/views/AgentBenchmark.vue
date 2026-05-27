<script setup lang="ts">
import { nextTick, ref } from "vue";

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "http://localhost:4000";
const TURN_DELAY_MS = 2000;
const SPEECH_GAP_MS = 800;

// ─── Types ────────────────────────────────────────────────────────────────────

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
                'bg-emerald-500': s < currentStage || status === 'completed',
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
