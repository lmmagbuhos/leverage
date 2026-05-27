<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";

// Relative on purpose → Vite proxies /api to the backend server-side, avoiding the
// browser's ERR_UNSAFE_PORT block on :6000 and any cross-origin issues.
const API_BASE_URL = "";

type Speaker = "negotiator" | "bato";
interface Turn { speaker: Speaker; text: string; ts: string }
interface Emotion { ts: string; primary: string; intensity: number; valence: number; shift?: string }
interface MediaEntry { ts: string; type: "press" | "coaching"; content: Record<string, unknown> }
interface StageScore { stage: number; score: number; positives: string[]; negatives: string[] }
interface SessionDoc {
  current_stage: number;
  stage_passed: Record<string, boolean>;
  transcript: Turn[];
  bato_emotion_ts: Emotion[];
  media_log: MediaEntry[];
  outcome: string | null;
  rubric: { perStage: StageScore[]; total15: number | null };
}

const STAGES = [
  { n: 1, name: "Active Listening" },
  { n: 2, name: "Empathy" },
  { n: 3, name: "Rapport" },
  { n: 4, name: "Influence" },
  { n: 5, name: "Behavioral Change" }
];

const sessionId = ref<string | null>(null);
const transcript = ref<Turn[]>([]);
const currentStage = ref(1);
const stagePassed = ref<Record<string, boolean>>({});
const emotions = ref<Emotion[]>([]);
const media = ref<MediaEntry[]>([]);
const outcome = ref<string | null>(null);
const rubric = ref<{ perStage: StageScore[]; total15: number | null }>({ perStage: [], total15: null });
const draft = ref("");
const busy = ref(false);
const error = ref("");
const transcriptEl = ref<HTMLElement | null>(null);

const latestEmotion = computed(() => emotions.value[emotions.value.length - 1] ?? null);
const latestPress = computed(
  () => [...media.value].reverse().find((m) => m.type === "press")?.content as
    | { headline?: string; body?: string }
    | undefined
);
const latestCoaching = computed(
  () => [...media.value].reverse().find((m) => m.type === "coaching")?.content as
    | { note?: string; technique?: string }
    | undefined
);
const ended = computed(() => outcome.value !== null);

function valenceColor(v: number): string {
  if (v < -0.15) return "#f87171";
  if (v > 0.15) return "#34d399";
  return "#fbbf24";
}

async function scrollDown() {
  await nextTick();
  transcriptEl.value?.scrollTo({ top: transcriptEl.value.scrollHeight, behavior: "smooth" });
}

function applySession(s: SessionDoc) {
  transcript.value = s.transcript;
  currentStage.value = s.current_stage;
  stagePassed.value = s.stage_passed;
  emotions.value = s.bato_emotion_ts;
  media.value = s.media_log;
  outcome.value = s.outcome;
  rubric.value = s.rubric;
  void scrollDown();
}

async function startSession() {
  busy.value = true;
  error.value = "";
  try {
    const res = await fetch(`${API_BASE_URL}/api/demo/start`, { method: "POST" });
    if (!res.ok) throw new Error(`start failed (${res.status})`);
    const data = await res.json();
    sessionId.value = data.session_id;
    currentStage.value = data.current_stage ?? 1;
    transcript.value = data.opening ? [{ speaker: "bato", text: data.opening, ts: "" }] : [];
    if (data.opening) speak(data.opening);
    void scrollDown();
  } catch (e) {
    error.value = String(e);
  } finally {
    busy.value = false;
  }
}

async function send() {
  const text = draft.value.trim();
  if (!text || !sessionId.value || busy.value || ended.value) return;
  busy.value = true;
  error.value = "";
  // optimistic
  transcript.value = [...transcript.value, { speaker: "negotiator", text, ts: "" }];
  draft.value = "";
  void scrollDown();
  try {
    const res = await fetch(`${API_BASE_URL}/api/demo/${sessionId.value}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text })
    });
    if (!res.ok) throw new Error(`message failed (${res.status})`);
    const data = await res.json();
    if (data.session) applySession(data.session as SessionDoc);
    if (data.reply) speak(data.reply as string);
  } catch (e) {
    error.value = String(e);
  } finally {
    busy.value = false;
  }
}

async function endAndScore() {
  if (!sessionId.value || busy.value) return;
  busy.value = true;
  try {
    const res = await fetch(`${API_BASE_URL}/api/demo/${sessionId.value}/finish`, { method: "POST" });
    if (res.ok) {
      const data = await res.json();
      if (data.session) applySession(data.session as SessionDoc);
    }
  } catch (e) {
    error.value = String(e);
  } finally {
    busy.value = false;
  }
}

// --- Voice: browser-native Web Speech API (TTS out + push-to-talk STT in) ---
const listening = ref(false);
const heard = ref(""); // live transcript while the mic is recording

function micError(code: string): string {
  if (code === "not-allowed" || code === "service-not-allowed")
    return "Microphone blocked — allow mic access (and make sure you're on https).";
  if (code === "no-speech") return "No speech detected — tap and speak again.";
  if (code === "audio-capture") return "No microphone found.";
  return "mic error: " + code;
}
const SpeechRec =
  (window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown })
    .SpeechRecognition ||
  (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
const speechSupported = !!SpeechRec;
let recognition: { start(): void; stop(): void } | null = null;

function speak(text: string) {
  if (!("speechSynthesis" in window)) return;
  const clean = text.replace(/\*[^*]*\*/g, " ").replace(/\s+/g, " ").trim();
  if (!clean) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(clean);
  u.rate = 0.98;
  u.pitch = 0.9;
  window.speechSynthesis.speak(u);
}

async function toggleListen() {
  if (!speechSupported || busy.value || ended.value || !sessionId.value) return;
  if (listening.value) {
    recognition?.stop();
    return;
  }
  if (!window.isSecureContext) {
    error.value = "Mic needs a secure context — open the https:// URL.";
    return;
  }
  heard.value = "";
  error.value = "";
  // Force the mic-permission prompt on this origin (SpeechRecognition alone often won't).
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
  } catch (err) {
    error.value =
      "Allow microphone access for this site, then tap again (" +
      String((err as Error)?.name || err) +
      ").";
    return;
  }
  let dispatched = false;
  let sawSound = false;
  const dispatch = () => {
    const text = heard.value.trim();
    if (!dispatched && text) {
      dispatched = true;
      draft.value = text;
      void send();
    }
  };
  const rec = new (SpeechRec as new () => Record<string, unknown>)() as Record<string, unknown> & {
    start(): void;
    stop(): void;
  };
  rec.lang = "en-US";
  rec.interimResults = true; // show words live as they're recognized
  rec.continuous = true; // keep listening through pauses; the user taps Stop to send
  rec.onresult = (e: { results: ArrayLike<{ 0: { transcript: string } }> }) => {
    let full = "";
    for (let i = 0; i < e.results.length; i++) {
      full += e.results[i][0].transcript;
    }
    heard.value = full.trim();
    // do NOT auto-send — only send when the user taps Stop (onend)
  };
  rec.onsoundstart = () => {
    sawSound = true;
  };
  rec.onerror = (e: { error?: string }) => {
    error.value = micError(e.error || "error");
    listening.value = false;
  };
  rec.onend = () => {
    listening.value = false;
    dispatch(); // tapping stop (or a natural pause) sends whatever was captured
    if (!dispatched && !error.value) {
      error.value = sawSound
        ? "Heard audio but couldn't transcribe — use Chrome/Edge and speak a clear sentence."
        : "No audio reached the recognizer — check the mic input device isn't muted/virtual.";
    }
  };
  recognition = rec;
  listening.value = true;
  try {
    rec.start();
  } catch (e) {
    listening.value = false;
    error.value = "Could not start mic: " + String(e);
  }
}

onMounted(() => void startSession());
</script>

<template>
  <main class="min-h-screen bg-[#05070a] text-slate-100">
    <header class="border-b border-white/10 bg-[#090d12]">
      <div class="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
        <div>
          <p class="text-xs font-semibold uppercase tracking-[0.28em] text-red-300/80">Leverage · Human Training</p>
          <h1 class="mt-1 text-2xl font-semibold text-white">The Stairway — Bato dela Rosa</h1>
        </div>
        <button
          class="border border-white/15 bg-white/[0.04] px-4 py-2 text-sm text-slate-200 transition hover:bg-white/10 disabled:opacity-50"
          :disabled="busy"
          @click="startSession"
        >
          Restart
        </button>
      </div>
    </header>

    <!-- Stage stairway -->
    <section class="mx-auto max-w-6xl px-5 pt-5">
      <ol class="grid grid-cols-5 gap-2">
        <li
          v-for="s in STAGES"
          :key="s.n"
          class="border px-3 py-2 text-center"
          :class="
            currentStage === s.n
              ? 'border-red-300/50 bg-red-950/40 text-white'
              : stagePassed[String(s.n)]
                ? 'border-emerald-400/40 bg-emerald-950/30 text-emerald-200'
                : 'border-white/10 bg-white/[0.02] text-slate-500'
          "
        >
          <div class="font-mono text-xs">Stage {{ s.n }} <span v-if="stagePassed[String(s.n)]">✓</span></div>
          <div class="mt-0.5 text-[11px] leading-tight">{{ s.name }}</div>
        </li>
      </ol>
    </section>

    <section class="mx-auto grid max-w-6xl gap-5 px-5 py-5 lg:grid-cols-[1.3fr_0.7fr]">
      <!-- Conversation -->
      <div class="flex min-h-[60vh] flex-col border border-white/10 bg-[#0b1118]">
        <div ref="transcriptEl" class="flex-1 space-y-3 overflow-y-auto p-5" style="max-height: 60vh">
          <div v-if="!transcript.length && !busy" class="text-sm italic leading-relaxed text-slate-500">
            Senator Bato dela Rosa is reachable through a trusted intermediary. <strong class="text-slate-300">You make first contact</strong> — open the conversation. (🎤 push to talk, or type below.)
          </div>
          <div v-for="(t, i) in transcript" :key="i" class="flex" :class="t.speaker === 'negotiator' ? 'justify-end' : 'justify-start'">
            <div
              class="max-w-[80%] px-4 py-2 text-sm"
              :class="t.speaker === 'negotiator' ? 'bg-sky-900/50 text-sky-50' : 'bg-white/[0.05] text-slate-200'"
            >
              <div class="mb-0.5 text-[10px] uppercase tracking-wider opacity-60">{{ t.speaker === 'negotiator' ? 'You (Negotiator)' : 'Bato' }}</div>
              {{ t.text }}
            </div>
          </div>
          <div v-if="busy" class="text-xs italic text-slate-500">Bato is responding…</div>
        </div>

        <div v-if="ended" class="border-t border-emerald-400/20 bg-emerald-950/20 px-5 py-3 text-sm text-emerald-200">
          Session ended — outcome: <strong>{{ outcome }}</strong>
          <span v-if="rubric.total15 !== null"> · BCSM score {{ rubric.total15 }}/15</span>
        </div>

        <div class="border-t border-white/10 p-3">
          <div class="flex gap-2">
            <button
              v-if="speechSupported"
              class="px-3 py-2 text-sm font-semibold transition disabled:opacity-50"
              :class="listening ? 'bg-emerald-600 text-white animate-pulse' : 'border border-white/15 text-slate-200 hover:bg-white/10'"
              :disabled="busy || ended || !sessionId"
              @click="toggleListen"
            >
              {{ listening ? "🟢 Recording… tap to send" : "🎤 Push to talk" }}
            </button>
            <input
              v-model="draft"
              :disabled="busy || ended || !sessionId"
              placeholder="…or type your line to Bato"
              class="flex-1 bg-white/[0.04] px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-600 disabled:opacity-50"
              @keydown.enter="send"
            />
            <button
              class="bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-500 disabled:opacity-50"
              :disabled="busy || ended || !sessionId"
              @click="send"
            >
              Send
            </button>
            <button
              class="border border-white/15 px-3 py-2 text-sm text-slate-300 transition hover:bg-white/10 disabled:opacity-50"
              :disabled="busy || ended || !sessionId"
              @click="endAndScore"
            >
              End &amp; Score
            </button>
          </div>
          <p v-if="listening" class="mt-2 text-xs text-emerald-300">
            🔴 Recording… {{ heard ? `“${heard}”` : "(speak, then tap to send)" }}
          </p>
          <p v-else-if="heard && !busy" class="mt-2 text-xs text-slate-400">🎙 Sent: “{{ heard }}”</p>
          <p v-if="error" class="mt-2 text-xs text-red-300">{{ error }}</p>
        </div>
      </div>

      <!-- Signals -->
      <aside class="grid content-start gap-4">
        <div class="border border-white/10 bg-[#0b1118] p-4">
          <p class="text-xs uppercase tracking-[0.22em] text-slate-500">Bato — Emotional State</p>
          <template v-if="latestEmotion">
            <p class="mt-2 text-2xl font-semibold capitalize text-white">{{ latestEmotion.primary }}</p>
            <div class="mt-2 h-2 overflow-hidden bg-slate-800">
              <div class="h-full transition-all" :style="{ width: `${Math.round(latestEmotion.intensity * 100)}%`, backgroundColor: valenceColor(latestEmotion.valence) }" />
            </div>
            <div class="mt-3 flex flex-wrap gap-1">
              <span
                v-for="(e, i) in emotions"
                :key="i"
                class="px-1.5 py-0.5 text-[10px] capitalize"
                :style="{ backgroundColor: valenceColor(e.valence) + '33', color: valenceColor(e.valence) }"
              >{{ e.primary }}</span>
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

        <div v-if="rubric.total15 !== null" class="border border-emerald-400/20 bg-[#0b1118] p-4">
          <p class="text-xs uppercase tracking-[0.22em] text-slate-500">BCSM Score</p>
          <p class="mt-1 text-3xl font-semibold text-white">{{ rubric.total15 }}<span class="text-base text-slate-500">/15</span></p>
          <ul class="mt-2 space-y-1 text-xs text-slate-400">
            <li v-for="ps in rubric.perStage" :key="ps.stage">Stage {{ ps.stage }}: {{ ps.score }}/3</li>
          </ul>
        </div>
      </aside>
    </section>
  </main>
</template>
