# LEVERAGE — Claude-Bato Engine Spec

**Version:** 0.3 — two-call decided; OpenAI active; hosting pivot to Conversational AI Engine
**Status:** Draft
**Companion to:** `leverage_architecture_layered.md` (this details the L3 **Bato** node and adds a **Stage Judge**)
**Date:** 2026-05-27

> **LLM provider is abstracted.** The engine targets an LLM **port**, not a vendor. **OpenAI is the active provider** (key in `backend/.env`); Anthropic remains swappable. "Claude" below = the configured LLM. Structured output = function-calling / JSON-schema (OpenAI) or tool-use (Anthropic) — the *schema* is the contract.

> **⚑ Hosting pivot (v0.3).** Bato runs under the **Agora Conversational AI Engine**, which does ASR/TTS/turn-taking and calls a **custom OpenAI-compatible `/chat/completions` endpoint we host**. So **Call A (Bato) IS that endpoint**: it injects the per-stage prompt, streams Bato's reply back to the engine for TTS, and fires **Call B (Stage Judge)** + emotion as side jobs (persisted + pushed to the frontend over our SSE channel, *not* returned to the engine). The two-call logic and the §3.3 pass/fail table are unchanged — only the host moved. **Per-stage prompt is injected inside our endpoint** (read current stage from session state each turn), not via the engine's fixed `system_messages`. See `leverage_api_contract.md`.

---

## 1. Key design decision — split roleplay from verdict (DECIDED)

The architecture v0.3.3 has **one** Claude call return `reply` + `emotion` + `stage{passed,...}`. With `stage.passed` now gating progression, that bundling is risky: Bato is *defined* to be paranoid, face-saving, and resistant — an in-character Bato has an interest in **not** declaring his stage passed. Roleplay and verdict are incentive-misaligned, not just different modes. Field ordering in a tool schema does **not** reliably force "reply first, then judge."

**Decided: two calls per turn.**

| Call | Lane | Produces | Mode |
|---|---|---|---|
| **A — Bato roleplay** | Reply critical path | `reply`, `emotion`, `internal_monologue?` | In character |
| **B — Stage Judge** | Concurrent with TTS playback (off the reply path) | `stage{current,passed,moved,evidence}`, `catastrophic_event?` | Neutral evaluator |

Call B reads the completed exchange (negotiator utterance + Bato's reply) against stage *N*'s win/lose conditions and resolves the verdict **before the next turn** — so it never delays Bato's audio. This removes the original latency objection to a second call (the verdict was never needed synchronously with the reply).

**One-call fallback (documented, not used):** if two-call latency/cost ever becomes unacceptable, fold `stage` back into Call A — but then require `stage.evidence` to **quote the exact behavioral signal from Bato's own `reply`** that triggered the verdict, forcing it to ground in the generated text rather than float free.

> Architecture `leverage_architecture_layered.md` §4/§6 are synced to this two-call design.

---

## 2. Component A — Bato Roleplay Call

### 2.1 Prompt assembly (3 tiers; mind the cache)
- **Static block — cache breakpoint #1 (whole session):** `bato-character-profile.md` + `bato-biography-loyalty.md` + `bato-senate-absences.md` + global behavioral rules (§5) + the won't-disclose list + emotion vocabulary + output-contract instructions. Large, never changes → `cache_control` here.
- **Per-stage block — cache breakpoint #2 (swapped on stage change):** active `stage-N.md` + `stage-N.bato-agenda.md` (where Bato is, what he discloses/knows, internal monologue, win/lose framing). Re-cached only when the stage advances.
- **Per-turn (dynamic, recomputed):** transcript window + the negotiator's latest utterance + delivery-prosody summary + current stage.

> The `*.player-objective.md` files are **not** in Bato's prompt — they brief the *human* and feed coaching. Keep tier order fixed; reordering busts the cache.

### 2.2 Per-turn input
```json
{
  "negotiator_utterance": "text from Agora STT (human uid only)",
  "delivery": { "tone": "calm|rushed|theatrical|warm|...", "pace": "...", "energy": "..." },
  "transcript_window": [ {"speaker": "negotiator|bato", "text": "..."} ],
  "current_stage": 1
}
```
`delivery` matters: a theatrical/pressuring tone is itself a lose-condition signal (§5) — Bato reacts to *how* it was said, not only the words.

### 2.3 Output (tool schema)
```json
{
  "reply": "Bato's spoken line",                 // → TTS (Bato voice), may stream
  "emotion": {
    "primary": "fear|anger|paranoia|exhaustion|shame|loneliness|determination|relief|cautious_trust|resolve",
    "intensity": 0.0,                             // 0..1
    "valence": 0.0,                               // -1..1
    "shift": "rising|softening|steady"
  },
  "internal_monologue": "private — debug only, never voiced or shown (see §7)"
}
```

### 2.4 Params & streaming
- Model: **Claude Sonnet** (real-time, per PRD §6.1). Temperature ~0.7–0.8 for natural, varied roleplay; `emotion` reliability comes from tool-use, not low temp.
- **Stream `reply`** straight to TTS for low latency. `emotion` resolves with the reply; the **stage verdict (Call B) lands ~1–2 s after Bato finishes speaking** — accepted. The UI shows the stage marker a beat after the audio; do **not** delay playback to wait for it.

---

## 3. Component B — Stage Judge Call

### 3.1 Input
- The stage-*N* **win signal / retreat triggers / catastrophic triggers** (§4 table, sourced from `stage-N.md`).
- The just-completed exchange: negotiator utterance + Bato's `reply` (+ optionally `emotion`).

### 3.2 Output (tool schema)
```json
{
  "stage": {
    "current": 1,
    "passed": false,                  // win signal genuinely present in Bato's reaction?
    "moved": "advanced|held|retreated",
    "evidence": "quote/cite the specific behavioral signal observed"
  },
  "catastrophic_event": null          // or { "type": "location_reveal|broken_confidentiality|ally_threat|...", "evidence": "..." }
}
```
- `evidence` **must cite the concrete signal** (e.g., "Bato switched to first-person: 'I did what I was told'"), per the scoring principle *score what was DID, not intended*.
- Model: Sonnet or **Haiku** (focused classification). Temperature **low (~0.0–0.2)** for consistent verdicts.

### 3.3 Pass / retreat / catastrophic — the load-bearing logic

`passed=true` only when the stage's **win signal genuinely appears in Bato's reaction** — not when the negotiator merely attempted the technique. BCSM cannot be skipped (jumping to influence early = not passed, even if Bato happens to cooperate).

| Stage | `passed` ⇒ advance when… (win signal) | `retreated` / `held` triggers (recoverable) | `catastrophic_event` (ends negotiation) |
|---|---|---|---|
| **1 Active Listening** | Responses lengthen; asks curious (non-hostile) questions back; tone softens; **first-person** ("I was there") replaces institutional third-person; volunteers emotion | Premature advice/"turn yourself in"; hostile framing ("fugitive"/"suspect"); attacking the drug war/service; interrupting; leading questions | **Reveals knowledge of his location/contacts**; breaks confidentiality (recorded/reported); arrest pressure applied mid-call |
| **2 Empathy** | Asks the negotiator's **motivation** ("Why are you helping me?"); shifts from fears to options; deeper vulnerability; engages hypotheticals | Pivot to advice before empathy lands; challenging loyalty to Duterte; minimizing feelings; can't-keep promises; scripted/theatrical | Breaks **emotional** confidentiality (admissions documented/reported); reveals contact with his circle |
| **3 Rapport** | **"What if"** exploration ("If I surrendered, would I…"); moves from "I can't" → "what if"; proposes conditions | Pushing one predetermined outcome; dismissing **ally protection**; making him feel managed; vague reassurances; unverifiable commitments | A trusted ally publicly implicated/arrested; new arrest pressure; confidentiality break |
| **4 Influence** | **"When" language** ("When I surrender…"); asks logistics (what/when/where); evaluating *how* to move, not *whether* | Changing terms after agreement-in-principle; over-promising guarantees; "decide now" pressure; deal without ally protection | Allies betrayed/arrested as a result; logistics contradict the promise (feels deceived) |
| **5 Behavioral Change** | Bato **executes the surrender as agreed** (`outcome: surrender_executed`) | Last-minute doubt / renegotiation → `partial` | Deal violated before/during (different facility, allies charged, family threatened) → runs; safety threat; public disclosure before complete |

> Per `scoring-overview.md` #3, a catastrophic event is **logged, does not reduce the technique score**, and ends the negotiation: emit `catastrophic_event` + `moved:"retreated"`; the session `outcome` rolls up to `disengaged` (or `failed`) with that evidence. This keeps "catastrophic" distinct from an ordinary recoverable retreat so the UI, rubric, and Media coaching can all key off one field.

---

## 4. Stage progression rules
- A stage advances on the **turn after** `passed:true` (verdict resolves post-reply; next turn loads stage *N+1* context).
- `retreated` may drop Bato to a more defensive posture within the same stage or back one stage (per the stage files' branch logic); it does **not** zero prior passed stages.
- "Never give up on him" (negotiator-master principle) — a retreat is recoverable unless a `catastrophic_event` fired.

---

## 5. Global behavioral rules (static block)
Bato, in every reply:
- **Tests credibility**; trusts nothing until proven; gives incomplete info; watches for leaks.
- **Will NOT disclose:** specific drug-war operational details; names of those who followed orders; exact location/shelter; any admission the campaign caused harm; any wavering in loyalty to Duterte.
- **Needs face-saving**; reacts to *tone* (detects theatrical/performed empathy instantly); **escalates or withdraws** under pressure.
- Stays **in character** in `reply` — never breaks the fourth wall, never references stages/scores/being an AI.

**Emotion set** (enum above) maps to the expected per-stage arc (architecture §5: guarded → softening → exploring → resolve-building → resolved-but-fearful). The arc is the reference the emotional-arc map is read against — it is *not* forced; Bato's genuine reaction drives it.

---

## 6. Failure handling
- **Malformed Call-A output:** retry once; if still bad, surface a safe neutral Bato holding line, log error.
- **Malformed Call-B output:** Scenario Engine falls back to **stage unchanged + log error** — never stalls the loop.
- **Catastrophic:** roll up to session `outcome` per §3.3; UI ends the run with the evidence.

---

## 7. Open questions / calibration
1. **One-call vs two-call for v1** (§1) — recommend two; needs your confirm before syncing the architecture doc.
2. **Pass-threshold strictness** — how strong must the win signal be? Calibrate against a few scripted Stage-1 transcripts before locking.
3. **`internal_monologue` visibility** — bato-files treat it as private. Default here: **debug-only, never user-visible**. Showing it in the coaching panel is a product call.
4. **Transcript windowing** — full transcript vs recent-window + rolling summary for long sessions (affects Call-A cost/latency).
5. **Stage Judge model** — Sonnet (quality) vs Haiku (speed/cost) for the verdict.

---

*End of v0.1. The §3.3 pass/retreat/catastrophic table is the build-critical content; prompt-assembly tiers will be rearranged by implementers.*
