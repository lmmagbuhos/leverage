<script setup lang="ts">
import AgoraRTC, {
  type IAgoraRTCClient,
  type IMicrophoneAudioTrack
} from "agora-rtc-sdk-ng";
import { computed, onBeforeUnmount, nextTick, ref } from "vue";

const API_BASE_URL = ""; // relative → Vite proxies /api to the backend

type Speaker = "negotiator" | "bato";
interface Turn { speaker: Speaker; text: string }
interface Emotion { primary: string; intensity: number; valence: number }
interface StageScore { stage: number; score: number }

const STAGES = [
  { n: 1, name: "Active Listening" },
  { n: 2, name: "Empathy" },
  { n: 3, name: "Rapport" },
  { n: 4, name: "Influence" },
  { n: 5, name: "Behavioral Change" }
];

const status = ref<"idle" | "connecting" | "live" | "ended">("idle");
const error = ref("");
const micLive = ref(false);
const audioBlocked = ref(false); // browser blocked autoplay of Bato's audio
const agentAudioReceived = ref(false); // did Bato's audio track arrive at all?
const sessionId = ref<string | null>(null);
const transcript = ref<Turn[]>([]);
const currentStage = ref(1);
const stagePassed = ref<Record<string, boolean>>({});
const emotions = ref<Emotion[]>([]);
const media = ref<{ type: string; content: Record<string, unknown> }[]>([]);
const outcome = ref<string | null>(null);
const rubric = ref<{ perStage: StageScore[]; total15: number | null }>({ perStage: [], total15: null });
const transcriptEl = ref<HTMLElement | null>(null);

let client: IAgoraRTCClient | null = null;
let mic: IMicrophoneAudioTrack | null = null;
let es: EventSource | null = null;
let remoteAudio: { play(): void } | null = null;

const latestEmotion = computed(() => emotions.value[emotions.value.length - 1] ?? null);
const latestPress = computed(() => [...media.value].reverse().find((m) => m.type === "press")?.content as { headline?: string; body?: string } | undefined);
const latestCoaching = computed(() => [...media.value].reverse().find((m) => m.type === "coaching")?.content as { note?: string; technique?: string } | undefined);

function valenceColor(v: number): string {
  if (v < -0.15) return "#f87171";
  if (v > 0.15) return "#34d399";
  return "#fbbf24";
}
async function scrollDown() {
  await nextTick();
  transcriptEl.value?.scrollTo({ top: transcriptEl.value.scrollHeight, behavior: "smooth" });
}

function openEvents(id: string) {
  es = new EventSource(`${API_BASE_URL}/api/session/${id}/events`);
  es.addEventListener("transcript", (e) => {
    const d = JSON.parse((e as MessageEvent).data);
    transcript.value = [...transcript.value, { speaker: d.speaker, text: d.text }];
    void scrollDown();
  });
  es.addEventListener("stage_update", (e) => {
    const d = JSON.parse((e as MessageEvent).data);
    currentStage.value = d.stage.current;
    if (d.stage.moved === "advanced") stagePassed.value = { ...stagePassed.value, [String(d.stage.current - 1)]: true };
    if (d.catastrophic_event) outcome.value = "disengaged";
  });
  es.addEventListener("bato_emotion", (e) => {
    const d = JSON.parse((e as MessageEvent).data);
    emotions.value = [...emotions.value, { primary: d.primary, intensity: d.intensity, valence: d.valence }];
  });
  es.addEventListener("coaching", (e) => {
    media.value = [...media.value, { type: "coaching", content: JSON.parse((e as MessageEvent).data) }];
  });
  es.addEventListener("press", (e) => {
    media.value = [...media.value, { type: "press", content: JSON.parse((e as MessageEvent).data) }];
  });
  es.addEventListener("session_end", (e) => {
    const d = JSON.parse((e as MessageEvent).data);
    outcome.value = d.outcome;
  });
}

async function startCall() {
  if (status.value === "connecting" || status.value === "live") return;
  status.value = "connecting";
  error.value = "";
  try {
    const res = await fetch(`${API_BASE_URL}/api/session/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ turn_mode: "push_to_talk" })
    });
    if (!res.ok) throw new Error(`start failed (${res.status}): ${await res.text()}`);
    const data = await res.json();
    sessionId.value = data.session_id;
    const a = data.agora;

    client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
    AgoraRTC.onAutoplayFailed = () => { audioBlocked.value = true; };
    client.on("user-published", async (user, mediaType) => {
      await client!.subscribe(user, mediaType);
      if (mediaType === "audio") {
        remoteAudio = user.audioTrack ?? null;
        agentAudioReceived.value = true; // Bato's audio track arrived
        try { remoteAudio?.play(); } catch { audioBlocked.value = true; }
      }
    });
    await client.join(a.appId, a.channelName, a.token, a.uid);
    mic = await AgoraRTC.createMicrophoneAudioTrack();
    await mic.setMuted(true); // push-to-talk: start muted
    await client.publish([mic]);

    openEvents(data.session_id);
    status.value = "live";
  } catch (e) {
    error.value = String(e);
    status.value = "idle";
  }
}

async function toggleMic() {
  if (!mic || status.value !== "live") return;
  micLive.value = !micLive.value;
  await mic.setMuted(!micLive.value);
}

function unlockAudio() {
  try { remoteAudio?.play(); } catch { /* ignore */ }
  audioBlocked.value = false;
}

async function endCall() {
  micLive.value = false;
  try {
    es?.close();
    es = null;
    if (mic) { mic.stop(); mic.close(); mic = null; }
    if (client) { await client.leave(); client = null; }
    if (sessionId.value) {
      await fetch(`${API_BASE_URL}/api/session/${sessionId.value}/stop`, { method: "POST" }).catch(() => {});
    }
  } finally {
    status.value = "ended";
  }
}

onBeforeUnmount(() => { void endCall(); });
</script>

<template>
  <main class="min-h-screen bg-[#05070a] text-slate-100">
    <header class="border-b border-white/10 bg-[#090d12]">
      <div class="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
        <div>
          <p class="text-xs font-semibold uppercase tracking-[0.28em] text-red-300/80">Leverage · Human Training · Voice</p>
          <h1 class="mt-1 text-2xl font-semibold text-white">The Stairway — Bato dela Rosa</h1>
        </div>
        <div class="flex items-center gap-2 text-sm">
          <span class="h-2.5 w-2.5 rounded-full" :class="status === 'live' ? 'bg-emerald-400' : status === 'connecting' ? 'bg-amber-400' : 'bg-slate-600'" />
          <span class="text-slate-400 capitalize">{{ status }}</span>
        </div>
      </div>
    </header>

    <section class="mx-auto max-w-6xl px-5 pt-5">
      <ol class="grid grid-cols-5 gap-2">
        <li v-for="s in STAGES" :key="s.n" class="border px-3 py-2 text-center"
          :class="currentStage === s.n ? 'border-red-300/50 bg-red-950/40 text-white' : stagePassed[String(s.n)] ? 'border-emerald-400/40 bg-emerald-950/30 text-emerald-200' : 'border-white/10 bg-white/[0.02] text-slate-500'">
          <div class="font-mono text-xs">Stage {{ s.n }} <span v-if="stagePassed[String(s.n)]">✓</span></div>
          <div class="mt-0.5 text-[11px] leading-tight">{{ s.name }}</div>
        </li>
      </ol>
    </section>

    <section class="mx-auto grid max-w-6xl gap-5 px-5 py-5 lg:grid-cols-[1.3fr_0.7fr]">
      <div class="flex min-h-[58vh] flex-col border border-white/10 bg-[#0b1118]">
        <div ref="transcriptEl" class="flex-1 space-y-3 overflow-y-auto p-5" style="max-height: 58vh">
          <div v-if="status === 'idle'" class="text-sm italic leading-relaxed text-slate-500">
            Press <strong class="text-slate-300">Start Call</strong> to reach Senator Bato dela Rosa. You make first contact — hold the mic and open the conversation.
          </div>
          <div v-for="(t, i) in transcript" :key="i" class="flex" :class="t.speaker === 'negotiator' ? 'justify-end' : 'justify-start'">
            <div class="max-w-[80%] px-4 py-2 text-sm" :class="t.speaker === 'negotiator' ? 'bg-sky-900/50 text-sky-50' : 'bg-white/[0.05] text-slate-200'">
              <div class="mb-0.5 text-[10px] uppercase tracking-wider opacity-60">{{ t.speaker === 'negotiator' ? 'You' : 'Bato' }}</div>
              {{ t.text }}
            </div>
          </div>
        </div>

        <div v-if="outcome" class="border-t border-emerald-400/20 bg-emerald-950/20 px-5 py-3 text-sm text-emerald-200">
          Session ended — outcome: <strong>{{ outcome }}</strong>
        </div>

        <div class="flex flex-wrap items-center gap-3 border-t border-white/10 p-4">
          <button v-if="status === 'idle' || status === 'ended'"
            class="bg-red-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-red-500"
            @click="startCall">Start Call</button>

          <button v-if="status === 'live'"
            class="px-5 py-2.5 text-sm font-semibold transition"
            :class="micLive ? 'bg-emerald-600 text-white animate-pulse' : 'border border-white/20 text-slate-200 hover:bg-white/10'"
            @click="toggleMic">
            {{ micLive ? "🔴 Mic live — tap to mute" : "🎤 Tap to talk" }}
          </button>

          <button v-if="status === 'live'"
            class="border border-white/15 px-4 py-2.5 text-sm text-slate-300 transition hover:bg-white/10"
            @click="endCall">End Call</button>

          <button v-if="audioBlocked"
            class="bg-amber-500 px-4 py-2.5 text-sm font-semibold text-black transition hover:bg-amber-400"
            @click="unlockAudio">🔊 Enable Bato's audio</button>

          <span v-if="status === 'connecting'" class="text-sm text-amber-300">Connecting to the channel…</span>
          <span v-if="status === 'live' && agentAudioReceived" class="text-xs text-emerald-400">🔊 Bato's audio connected</span>
          <span v-else-if="status === 'live'" class="text-xs text-slate-500">Bato hears you only while the mic is live.</span>
        </div>
        <p v-if="error" class="px-4 pb-3 text-xs text-red-300">{{ error }}</p>
      </div>

      <aside class="grid content-start gap-4">
        <div class="border border-white/10 bg-[#0b1118] p-4">
          <p class="text-xs uppercase tracking-[0.22em] text-slate-500">Bato — Emotional State</p>
          <template v-if="latestEmotion">
            <p class="mt-2 text-2xl font-semibold capitalize text-white">{{ latestEmotion.primary }}</p>
            <div class="mt-2 h-2 overflow-hidden bg-slate-800">
              <div class="h-full transition-all" :style="{ width: `${Math.round(latestEmotion.intensity * 100)}%`, backgroundColor: valenceColor(latestEmotion.valence) }" />
            </div>
            <div class="mt-3 flex flex-wrap gap-1">
              <span v-for="(e, i) in emotions" :key="i" class="px-1.5 py-0.5 text-[10px] capitalize" :style="{ backgroundColor: valenceColor(e.valence) + '33', color: valenceColor(e.valence) }">{{ e.primary }}</span>
            </div>
          </template>
          <p v-else class="mt-2 text-sm text-slate-500">Awaiting first exchange…</p>
        </div>
        <div class="border border-white/10 bg-[#0b1118] p-4">
          <p class="text-xs uppercase tracking-[0.22em] text-slate-500">Coaching</p>
          <p class="mt-2 text-sm text-slate-200">{{ latestCoaching?.note || "—" }}</p>
          <p v-if="latestCoaching?.technique" class="mt-1 text-xs text-amber-300/80">technique: {{ latestCoaching.technique }}</p>
        </div>
        <div class="border border-white/10 bg-[#0b1118] p-4">
          <p class="text-xs uppercase tracking-[0.22em] text-slate-500">Media / Press</p>
          <p class="mt-2 text-sm font-semibold text-slate-100">{{ latestPress?.headline || "—" }}</p>
          <p class="mt-1 text-xs text-slate-400">{{ latestPress?.body }}</p>
        </div>
      </aside>
    </section>
  </main>
</template>
