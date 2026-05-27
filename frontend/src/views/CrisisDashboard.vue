<script setup lang="ts">
import { useIntervalFn } from "@vueuse/core";
import { computed, onMounted, ref } from "vue";
import { useAgora } from "../composables/useAgora";

type GameStage = 1 | 2 | 3;

interface GameState {
  session_id: string;
  stress_level: number;
  current_stage: GameStage;
  updated_at: string;
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";
const sessionId = "demo-session";

const state = ref<GameState>({
  session_id: sessionId,
  stress_level: 80,
  current_stage: 1,
  updated_at: new Date().toISOString()
});

const stageLabels: Record<GameStage, string> = {
  1: "De-escalation",
  2: "Bargaining",
  3: "The Close"
};

const { connectionState, errorMessage, isConnecting, isJoined, joinChannel, leaveChannel } =
  useAgora();

const stressColor = computed(() => {
  const hue = 120 - state.value.stress_level * 1.2;
  return `hsl(${hue} 86% 52%)`;
});

const stageLabel = computed(() => stageLabels[state.value.current_stage]);

const micLabel = computed(() => {
  if (isConnecting.value) {
    return "Connecting";
  }

  return isJoined.value ? "End Negotiation" : "Start Negotiation";
});

async function fetchGameState() {
  const url = new URL("/api/game/state", API_BASE_URL);
  url.searchParams.set("session_id", sessionId);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Game state request failed with ${response.status}`);
  }

  state.value = (await response.json()) as GameState;
}

async function nudgeStress(delta: number) {
  const response = await fetch(`${API_BASE_URL}/api/game/state`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      session_id: sessionId,
      stress_delta: delta
    })
  });

  if (!response.ok) {
    throw new Error(`Game state update failed with ${response.status}`);
  }

  state.value = (await response.json()) as GameState;
}

async function toggleNegotiation() {
  if (isJoined.value) {
    await leaveChannel();
    return;
  }

  await joinChannel("leverage-crisis-room");
}

onMounted(() => {
  void fetchGameState();
});

useIntervalFn(() => {
  void fetchGameState();
}, 5000);
</script>

<template>
  <main class="min-h-screen bg-[#05070a] text-slate-100">
    <section class="border-b border-white/10 bg-[#090d12]">
      <div class="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
        <div>
          <p class="text-xs font-semibold uppercase tracking-[0.28em] text-red-300/80">
            Leverage
          </p>
          <h1 class="mt-1 text-2xl font-semibold tracking-normal text-white">
            Crisis Negotiation Console
          </h1>
        </div>

        <div class="text-right">
          <p class="text-xs uppercase tracking-[0.2em] text-slate-500">Channel</p>
          <p class="mt-1 font-mono text-sm text-slate-200">leverage-crisis-room</p>
        </div>
      </div>
    </section>

    <section class="mx-auto grid max-w-6xl gap-5 px-5 py-6 lg:grid-cols-[1.1fr_0.9fr]">
      <div class="border border-white/10 bg-[#0b1118] p-5">
        <div class="flex items-start justify-between gap-4">
          <div>
            <p class="text-xs uppercase tracking-[0.22em] text-slate-500">Live Session</p>
            <h2 class="mt-2 text-4xl font-semibold tracking-normal text-white">
              Stage {{ state.current_stage }}
            </h2>
            <p class="mt-2 text-lg text-slate-300">{{ stageLabel }}</p>
          </div>

          <div
            class="h-3 w-3 rounded-full"
            :class="isJoined ? 'bg-emerald-400 shadow-[0_0_18px_#34d399]' : 'bg-red-500 shadow-[0_0_18px_#ef4444]'"
          />
        </div>

        <div class="mt-10 flex justify-center">
          <button
            class="grid h-48 w-48 place-items-center rounded-full border border-red-300/30 bg-red-600 text-center text-lg font-semibold text-white shadow-[0_0_60px_rgba(220,38,38,0.35)] transition hover:bg-red-500 disabled:cursor-wait disabled:opacity-70"
            :disabled="isConnecting"
            @click="toggleNegotiation"
          >
            <span>{{ micLabel }}</span>
          </button>
        </div>

        <p
          v-if="errorMessage"
          class="mt-6 border border-red-400/30 bg-red-950/40 px-4 py-3 text-sm text-red-100"
        >
          {{ errorMessage }}
        </p>
      </div>

      <aside class="grid gap-5">
        <div class="border border-white/10 bg-[#0b1118] p-5">
          <div class="flex items-end justify-between">
            <div>
              <p class="text-xs uppercase tracking-[0.22em] text-slate-500">
                Stress Level
              </p>
              <p class="mt-2 text-5xl font-semibold tracking-normal text-white">
                {{ state.stress_level }}
              </p>
            </div>
            <p class="text-sm uppercase tracking-[0.18em] text-slate-400">
              {{ connectionState }}
            </p>
          </div>

          <div class="mt-6 h-4 overflow-hidden bg-slate-800">
            <div
              class="h-full transition-all duration-500"
              :style="{ width: `${state.stress_level}%`, backgroundColor: stressColor }"
            />
          </div>

          <div class="mt-5 grid grid-cols-2 gap-3">
            <button
              class="border border-emerald-300/20 bg-emerald-950/40 px-4 py-3 text-sm font-semibold text-emerald-100 transition hover:bg-emerald-900/60"
              @click="nudgeStress(-10)"
            >
              De-escalate
            </button>
            <button
              class="border border-red-300/20 bg-red-950/40 px-4 py-3 text-sm font-semibold text-red-100 transition hover:bg-red-900/60"
              @click="nudgeStress(10)"
            >
              Escalate
            </button>
          </div>
        </div>

        <div class="border border-white/10 bg-[#0b1118] p-5">
          <p class="text-xs uppercase tracking-[0.22em] text-slate-500">Stages</p>
          <ol class="mt-4 grid gap-3">
            <li
              v-for="stage in [1, 2, 3] as GameStage[]"
              :key="stage"
              class="flex items-center justify-between border px-4 py-3"
              :class="
                state.current_stage === stage
                  ? 'border-red-300/40 bg-red-950/30 text-white'
                  : 'border-white/10 bg-white/[0.02] text-slate-400'
              "
            >
              <span class="font-mono text-sm">Stage {{ stage }}</span>
              <span class="text-sm">{{ stageLabels[stage] }}</span>
            </li>
          </ol>
        </div>
      </aside>
    </section>
  </main>
</template>
