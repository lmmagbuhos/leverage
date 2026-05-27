# LEVERAGE — Human Training: API Contract (Frontend Handoff)

**Version:** 0.2 — Draft (session-routing + Marsview verified against Agora docs)
**Status:** The handoff boundary. Backend implements + verifies these; the frontend developer builds against them.
**Engine:** Agora Conversational AI Engine (managed ASR/TTS/turn-taking) + custom OpenAI-compatible LLM endpoint (Bato) + Marsview prosody.
**Companions:** `leverage_architecture_layered.md` (v0.5), `leverage_bato_engine_spec.md` (v0.3).
**Date:** 2026-05-27

---

## 1. Actors & transport

```
                    ┌─────────────────────────────────────────────┐
   BROWSER          │                BACKEND (Express/TS)          │
 (Vite + Agora SDK) │                                              │
   │  REST  ───────────────►  /api/agora/token                     │
   │        ───────────────►  /api/session/start  (starts agent)   │
   │        ───────────────►  /api/session/:id/stop                │
   │        ───────────────►  GET /api/session/:id                 │
   │  SSE   ◄───────────────  GET /api/session/:id/events          │  ← Bato emotion, stage,
   │                          (our derived signals)                │    press, coaching, rubric
   │                                                               │
   │                          POST /api/llm/chat/completions  ◄────── Agora engine (internal)
   │                          (OpenAI-compatible; Bato + Judge)    │
   └───────────────────────────────────────────────────────────── │
   │  Agora RTC SDK                                                 │
   ├─ publish negotiator mic ─────► RTC channel ◄──── Agora CAIE agent (Bato voice / TTS)
   ├─ play Bato TTS audio    ◄───── RTC channel                    │
   ├─ data stream  ◄───────────────  transcripts (user + agent, `final`)
   └─ Marsview extension ──────────► negotiator prosody (data stream)
```

**Two realtime sources for the frontend (by design):**
1. **Agora data stream** (via the Agora SDK, frontend is in the channel) → live transcripts + Marsview prosody.
2. **Our SSE** (`/api/session/:id/events`) → derived signals we compute (Bato emotion, stage verdict, press, coaching, rubric).

Audio (mic in, Bato voice out) is pure Agora RTC. The backend never relays media.

**Secrets boundary:** OpenAI key, Agora App Certificate, Couchbase creds are **server-side only**. The frontend gets a short-lived Agora **token** + a `session_id`; nothing else.

---

## 2. REST endpoints (frontend-facing)

### `GET /health` *(exists)*
→ `200 { "ok": true, "service": "leverage-backend" }`

### `GET /api/agora/token` *(exists)*
Query: `channelName?`, `uid?`
→ `200 { appId, channelName, uid, token, expiresIn }`
(Usually you won't call this directly — `/api/session/start` returns the same Agora block.)
Token lifetime = `expiresIn` (default 3600s). The demo accepts that cap; for longer sessions the frontend re-calls this on Agora's `token-privilege-will-expire` event and `client.renewToken()`.

### `POST /api/session/start`
Starts a session **and** the Conversational AI agent (backend calls Agora `join`, pointing the engine's `llm.url` at our custom endpoint §4).
Body:
```json
{ "scenario": "bato-dela-rosa", "turn_mode": "push_to_talk" | "open_mic" }
```
→ `201`
```json
{
  "session_id": "uuid",
  "agora": { "appId": "...", "channelName": "...", "uid": 12345, "token": "...", "expiresIn": 3600 },
  "agent_id": "agora-agent-id",
  "stage": { "current": 1, "passed": false },
  "turn_mode": "push_to_talk"
}
```
Frontend then: join the Agora channel with `agora`, and open the SSE stream (§3).

### `POST /api/session/:id/stop`
Stops the agent (Agora `leave`) and finalizes the session.
→ `200 { "outcome": "surrender|partial|disengaged|failed", "final_stage_reached": 3, "report_ready": true }`

### `GET /api/session/:id`
→ `200` the full session document (§5). Use for reconnect/replay/report.

### `PATCH /api/session/:id/turn-mode`
Body `{ "turn_mode": "push_to_talk" | "open_mic" }` → `200 { turn_mode }`.
(Open-mic uses the engine's VAD turn detection; push-to-talk = frontend only publishes mic audio while the user holds/toggles — see §6.)

---

## 3. SSE — `GET /api/session/:id/events`

`text/event-stream`. Each event: `event: <type>` + `data: <json>`. Types:

**`bato_emotion`** — Bato's generated emotional state (the study object):
```json
{ "ts": "ISO", "primary": "fear", "intensity": 0.7, "valence": -0.4, "shift": "softening" }
```

**`stage_update`** — the Stage Judge verdict (lands ~1–2 s after Bato's reply):
```json
{ "ts": "ISO", "stage": { "current": 1, "passed": false, "moved": "held", "evidence": "..." },
  "catastrophic_event": null }
```

**`press`** — in-world media reaction (live during the run):
```json
{ "ts": "ISO", "headline": "...", "body": "..." }
```

**`coaching`** — feedback tied to the negotiator's move/delivery:
```json
{ "ts": "ISO", "note": "...", "technique": "mirroring", "emotions_map_point": { "stage": 1, "expected": "guarded", "observed": "guarded" } }
```

**`rubric`** — AI-computed BCSM score (per-stage on advance, full at end):
```json
{ "ts": "ISO", "scope": "stage|session", "per_stage": [ { "stage": 1, "score": 2, "positives": [], "negatives": [] } ], "total_15": null }
```

**`session_end`**:
```json
{ "ts": "ISO", "outcome": "disengaged", "final_stage_reached": 3, "report": { } }
```

> On a `catastrophic_event` (carried in `stage_update`), the backend **automatically stops the agent** (Agora `leave`) and then emits `session_end` — the frontend should end the run on either signal.
>
> Transcripts and Marsview **negotiator prosody** are **NOT** on SSE — read them from the **Agora data stream** via the SDK (§4.3).

---

## 4. Internal: the custom-LLM endpoint (engine ↔ backend, not frontend)

### 4.1 `POST /api/llm/chat/completions`
**Called by the Agora engine, once per negotiator turn.** OpenAI Chat Completions compatible; **must stream SSE** (`chat.completion.chunk`).
- Request (from engine): `{ model, messages:[...], stream:true, ... }` — `messages` includes the engine's `system_messages` + the negotiator's `user` turn (ASR transcript).
- Our handler:
  1. Resolve `session_id` from the **request URL path** — at `join` the backend sets `llm.url = <host>/api/llm/<session_id>/chat/completions`, so each agent posts to its own session path. (Agora's `llm.url` is free-form; there is **no** custom-header mechanism — verified, so the path is the routing key.)
  2. Read **current stage** from session state; build **Bato's per-stage system prompt** (character + `stage-N.md` + `bato-agenda`) — overriding/augmenting the engine's `system_messages`.
  3. **Call A:** stream Bato's reply tokens back to the engine (→ TTS). 
  4. After the reply: **fire Call B (Stage Judge)** + **emotion** as async side jobs (do **not** block the SSE). They persist to the session and emit `stage_update` / `bato_emotion` on the frontend SSE.
- Response: standard OpenAI streamed `choices[].delta.content`. The engine only consumes the spoken text; emotion/stage never go back to the engine.
- **Async → SSE bridge:** Call B + emotion finish *after* the LLM response closes; they publish to that session's `/events` stream via an in-process event bus (fine for a single-process demo; back it with Redis pub/sub if the backend ever runs multi-process).

> Detail for Call A / Call B / pass-fail lives in `leverage_bato_engine_spec.md` §2–§3.3.

### 4.2 Agent start config (backend → Agora `join`)
Backend `POST https://api.agora.io/api/conversational-ai-agent/v2/projects/{appid}/join` (store the returned `agent_id` on the session). Verified body shape:
```json
{
  "name": "<session_id>",
  "properties": {
    "channel": "<channel>", "token": "<agent_rtc_token>", "agent_rtc_uid": "0",
    "llm": {
      "url": "https://<host>/api/llm/<session_id>/chat/completions",   // per-session routing
      "api_key": "<internal>",
      "system_messages": [{ "role": "system", "content": "(overridden per-stage in our endpoint)" }],
      "greeting_message": "(Bato's opening line — he speaks first)",
      "max_history": 20,
      "params": { "model": "gpt-4o", "temperature": 0.8 }
    },
    "asr": { "language": "en-US" },
    "tts": { "vendor": "microsoft", "params": { "voice_name": "(Bato voice — Filipino-accented neural)" } },
    "turn_detection": { }   // used for open-mic; PTT gates by mic publish (§6)
  }
}
```
`greeting_message` is how Bato opens the scene. The real per-stage prompt is injected inside our endpoint (§4.1), not via `system_messages`.

### 4.3 Agora data stream (frontend reads via SDK)
- **Transcripts:** messages for user + agent with a `final` boolean (in-progress → completed → interrupted). Render live captions.
- **Marsview prosody:** the negotiator's tone/emotion/sentiment, emitted by the Marsview extension loaded in the frontend. Render the negotiator delivery panel.

---

## 5. Session document (Couchbase)

```json
{
  "session_id": "uuid",
  "mode": "human-training",
  "scenario": "bato-dela-rosa",
  "agent_id": "...",
  "channel": "...",
  "turn_mode": "push_to_talk",
  "current_stage": 1,
  "stage_passed": { "1": false, "2": false, "3": false, "4": false, "5": false },
  "outcome": null,
  "transcript": [ { "speaker": "negotiator|bato", "text": "...", "ts": "..." } ],
  "negotiator_prosody_ts": [ { "ts": "...", "tone": "...", "sentiment": "...", "source": "marsview" } ],
  "bato_emotion_ts": [ { "ts": "...", "primary": "fear", "intensity": 0.7, "valence": -0.4 } ],
  "stage_ts": [ { "ts": "...", "stage": 1, "passed": false, "moved": "held", "evidence": "..." } ],
  "media_log": [ { "ts": "...", "type": "press|coaching", "content": {} } ],
  "rubric": { "per_stage": [], "total_15": null },
  "updated_at": "ISO"
}
```
*(Supersedes the scaffold's `stress_level`/3-stage `db.ts` shape; `stress_level` may return as a derived 0–100 scalar computed from `bato_emotion_ts`.)*

---

## 6. PTT vs open-mic
- **open_mic:** the engine's `turn_detection` (VAD) decides when the negotiator's turn ends → engine calls our LLM endpoint.
- **push_to_talk:** the frontend **publishes the mic track only while the user holds/toggles** (mute/unmute the local Agora audio track); on release the engine sees end-of-speech and ends the turn. No backend turn signal needed; the contract just records `turn_mode`.

---

## 7. Verification checklist (the "100% working" gate)
- [ ] `GET /api/agora/token` returns a token a real client can join with.
- [ ] `POST /api/session/start` starts a real Agora agent (agent joins the channel; `agent_id` returned).
- [ ] Custom `POST /api/llm/chat/completions` returns valid OpenAI SSE; engine TTS's Bato's reply.
- [ ] Bato per-stage prompt is injected from session state (stage swap verified across a transition).
- [ ] `stage_update` + `bato_emotion` emit on SSE after each turn; schema valid; stage gating correct.
- [ ] Stage Judge verdicts stable on a few scripted Stage-1 transcripts (pass/hold/retreat/catastrophic).
- [ ] Transcripts appear on the Agora data stream (user + agent, `final`).
- [ ] Marsview prosody appears on the data stream for the negotiator.
- [ ] `press`, `coaching`, `rubric`, `session_end` emit with valid schemas.
- [ ] `POST /api/session/:id/stop` → agent leaves; session finalized; report retrievable via `GET /api/session/:id`.
- [ ] End-to-end Stage-1 run green against **real** OpenAI + Agora.

---

## 8. Resolved + remaining

**Resolved (verified against current Agora docs):**
- **session_id ↔ engine routing** — per-session `llm.url` path (§4.1/§4.2). Agora exposes no custom-header mechanism, so the URL path is the routing key.
- **Marsview** — confirmed live in the Agora Extensions Marketplace (integration doc current). Negotiator prosody over the data stream stands. (Pin the exact payload fields when wiring §4.3.)

**Remaining (1 product choice):**
- **Derived-signal transport** — defaulting to **our SSE** (§3) for backend-decoupling. Alternative: push over the Agora data stream/RTM for a single realtime source. Confirm if you want unification.

---

*v0.1 — endpoints + schemas are the contract; §7 is the gate before frontend handoff.*
