# Bato dela Rosa Negotiation Scenario — App Demo Architecture

## Overview

This document describes how the MD files in `docs/superpowers/bato/` plug into a voice agent training and benchmarking application. The app has three core modes:

1. **Training Mode** — A human (trainee) speaks with Bato (AI). The trainee is scored by the scoring rubric.
2. **Benchmarking Mode** — The master negotiator autonomous agent speaks with Bato (AI). The agent is scored by the same rubric. Human and agent scores are compared.
3. **Free Play / Sandbox** — Either party can lead the conversation without scoring, for exploration and learning.

---

## File Map: What Each MD Is Used For

| File | Used By | Purpose |
|---|---|---|
| `bato-biography-loyalty.md` | Bato AI | Background context — who Bato is, where he came from, who he owes loyalty to |
| `bato-senate-absences.md` | Bato AI | Explains why Bato disappeared, his psychological withdrawal pattern |
| `bato-character-profile.md` | Bato AI | Master character file — current state, fears, decision-making, relationship map |
| `stages/stage-1-active-listening.md` | Bato AI | Stage-specific behavior guide (discloses, knows, win/lose conditions, branches) |
| `stages/stage-2-empathy.md` | Bato AI | Stage-specific behavior guide |
| `stages/stage-3-rapport.md` | Bato AI | Stage-specific behavior guide |
| `stages/stage-4-influence.md` | Bato AI | Stage-specific behavior guide |
| `stages/stage-5-behavioral-change.md` | Bato AI | Stage-specific behavior guide |
| `negotiator-master.md` | Master Negotiator Agent | System prompt — BCSM techniques, stage tactics, Bato-specific handling |
| `scoring-rubric.md` | Scoring Engine | The evaluation framework — per-stage criteria, positive/negative indicators, output format |

---

## Pipeline Architecture

### High-Level Flow

```
[User] → [Voice Interface] → [Conversation Engine]
                              ↓
              ┌─────────────────────────────────────┐
              │          Bato AI Agent              │
              │  (reads: biography, absences,        │
              │   character profile, current stage)   │
              └─────────────────────────────────────┘
                              ↓
[Audio Output / Visual Transcript]

                              ↓
              ┌─────────────────────────────────────┐
              │         Scoring Engine               │
              │  (reads: scoring-rubric.md +         │
              │   transcript → per-stage scores)     │
              └─────────────────────────────────────┘
                              ↓
              ┌─────────────────────────────────────┐
              │          Score Report               │
              │  (per-stage breakdown + total)       │
              └─────────────────────────────────────┘
```

### Mode-Specific Flow: Training Mode (Human Negotiator)

1. **Session Start:** User selects "Training Mode" and chooses the scenario (Bato dela Rosa).
2. **Bato AI Initialization:** The Bato AI agent reads:
   - `bato-biography-loyalty.md`
   - `bato-senate-absences.md`
   - `bato-character-profile.md`
   - `stages/stage-1-active-listening.md` (starting stage)
3. **Conversation Begins:** The human speaks through the voice interface. Bato responds based on his context files and the current stage.
4. **Stage Progression:** As Bato responds and the human uses stage-appropriate techniques, Bato's internal state advances through the stages. The appropriate stage MD is injected as the conversation progresses.
5. **Session End:** Either Bato successfully surrenders (Stage 5 complete), the human ends the session, or Bato disengages (failed outcome).
6. **Scoring:** The transcript is processed by the scoring engine (reads `scoring-rubric.md`) and a score report is generated.

### Mode-Specific Flow: Benchmarking Mode (Master Negotiator Agent)

1. **Session Start:** User selects "Benchmarking Mode" and chooses the scenario.
2. **Bato AI + Master Negotiator Agent Initialization:**
   - Bato AI reads the same context files as in Training Mode
   - Master Negotiator Agent reads `negotiator-master.md` as its system prompt
3. **Conversation Begins:** The master negotiator agent runs autonomously. It uses the BCSM techniques described in `negotiator-master.md` and attempts to move Bato through all five stages.
4. **Stage Progression:** Both agents are context-aware — Bato advances through stages as trust is built; the negotiator uses stage-appropriate tactics.
5. **Session End:** Same as Training Mode.
6. **Scoring:** The transcript is scored by the same scoring engine. The resulting score is the benchmark for the autonomous agent.

### Benchmarking: Human vs. Agent Comparison

When benchmarking, both runs use the same scenario, same starting stage, and same scoring rubric:

```
Benchmark Report
================
Scenario: Bato dela Rosa — ICC Fugitive Negotiation

Human Trainee Score:  [X]/15
  Stage breakdown: [list]

Master Negotiator Agent Score: [X]/15
  Stage breakdown: [list]

Delta: [Human score - Agent score]

Notes:
- Where did the human excel?
- Where did the agent outperform?
- Where were similar?
```

---

## Bato AI: Stage Management

### How Bato Advances Through Stages

The Bato AI does not advance stages automatically based on time. Stage advancement is **triggered by the negotiator's technique** — if the negotiator uses Stage 1 techniques and Bato responds positively, Bato moves to Stage 2. If the negotiator violates Stage 2 (pivots to influence too early), Bato stays in Stage 2 or retreats.

**Stage transition triggers:**
- **Stage 1 → Stage 2:** Negotiator uses active listening techniques; Bato's responses become longer, he asks questions back, tone softens
- **Stage 2 → Stage 3:** Negotiator labels emotions accurately; validates Bato's loyalty; Bato asks about the negotiator's motivations
- **Stage 3 → Stage 4:** Negotiator presents realistic options with honest tradeoffs; addresses ally protection; Bato proposes conditions and starts using "when" language
- **Stage 4 → Stage 5:** Negotiator articulates specific deal structure; Bato agrees to conditions; uses "when I surrender" language
- **Stage 5 → Complete:** Bato executes the surrender as agreed

### Branching Logic

Each stage file contains `If-Narrator Branches` — illustrative conditional responses. The Bato AI uses these as behavioral guides:

- **Branch A (positive):** Correct technique → Bato advances or opens up
- **Branch B (negative):** Technique violation → Bato retreats or ends conversation

The evaluator uses the same branches to annotate the transcript when scoring.

---

## Scoring Engine: How It Works

### Input
- Full conversation transcript (text or time-stamped audio with transcription)
- `scoring-rubric.md` (the evaluation criteria file)
- Optional: stage labels (which stage Bato was in at each point)

### Process
1. **Stage segmentation:** The transcript is divided into segments corresponding to each BCSM stage (based on when transitions occurred or time-based approximation if no explicit labels exist)
2. **Indicator detection:** Each segment is scanned for positive and negative indicators from the rubric:
   - Active Listening indicators: paraphrasing, open questions, mirroring, minimal encouragers, strategic pauses, emotional labeling, no interruptions
   - Empathy indicators: accurate emotional labeling, validation, loyalty acknowledgment, no pivoting to influence
   - Rapport indicators: multiple options, honest tradeoffs, ally protection addressed, Bato's agency
   - Influence indicators: specific deal terms, condition negotiation, face-saving framing
   - Behavioral Change indicators: logistics confirmed, continuity of contact, Bato executes
3. **Score calculation:** Each stage is scored 0-3 based on the ratio of positive to negative indicators and the quality of technique application
4. **Narrative breakdown generation:** Each stage gets a 2-3 sentence breakdown explaining the score
5. **Total score and overall assessment:** Final score (max 15) with summary paragraph

### Output
The scoring engine produces the format described in `scoring-rubric.md`:

```
Stage 1 — Active Listening: 2/3
[bulleted positive indicators]
[bulleted negative indicators]
[Narrative breakdown]

Stage 2 — Empathy: 1/3
...

TOTAL SCORE: 9/15

Overall Assessment:
[Paragraph]
```

---

## Voice Interface Considerations

The voice agent uses a speech-to-text → AI processing → text-to-speech pipeline:

1. **Input:** Human speech → transcribed to text
2. **Processing:** Text passed to the conversation engine (Bato AI + optionally the master negotiator agent)
3. **Output:** Response text → synthesized speech → Bato's voice

**Bato's voice characteristics (for synthesis):**
- Filipino accent, formal register
- Calm and measured pacing
- Slight edge of tension (he's in survival mode)
- Heavier voice when defensive; slightly warmer when in Stage 2-3 rapport

**Master Negotiator voice characteristics:**
- Neutral accent (international)
- Calm, warm, patient — the voice of someone who has all the time in the world
- Never rushed, never theatrical

---

## Demo Flow: How a Session Unfolds

### Step-by-Step: Training Mode with a Human

1. **Launch:** User opens the app, selects "Training Mode," sees a brief scenario briefing (text on screen: "You are a BCSM-trained negotiator. Senator Bato dela Rosa is a fugitive from an ICC arrest warrant. Your goal is to move him through the five stages toward voluntary surrender. You will be scored on your technique at each stage.")
2. **Start:** User clicks "Begin Negotiation." The voice channel opens.
3. **Bato's opening:** Bato speaks first (based on Stage 1 context). He introduces the situation in his own words — nervous, guarded, not yet trusting.
4. **Human responds:** The human speaks naturally. The scoring engine listens in real-time and annotates each utterance.
5. **Progression:** The conversation advances through stages. The UI shows a stage indicator (Stage 1 → Stage 2 → etc.) as Bato progresses.
6. **Outcomes:**
   - **Success:** Bato reaches Stage 5 and executes surrender. Score report displayed.
   - **Partial failure:** Bato disengages before Stage 5 — the conversation ends early. Score report shows what was achieved and where it broke down.
   - **Full failure:** Bato ends the conversation immediately due to a critical error (e.g., the human revealed his location). Score report notes the catastrophic technique failure.
7. **Score Report:** After each session, the full per-stage breakdown is displayed. User can review the transcript with scores annotated.

### Step-by-Step: Benchmarking Mode

1. **Launch:** User opens the app, selects "Benchmarking Mode."
2. **Configuration:** User can adjust scenario parameters (optional): starting stage, specific branches to trigger, time limits.
3. **Run:** The master negotiator agent runs autonomously against Bato. No human input during the run.
4. **Monitor:** Real-time transcript is visible as the agents converse.
5. **Score Report:** Same format as Training Mode. Scores are stored and compared to previous benchmarks.

---

## File Injection Strategy

When the app runs, the relevant MD files are injected into the AI context at the appropriate points:

**Bato AI context injection:**
```
At session start:
  - bato-biography-loyalty.md (full)
  - bato-senate-absences.md (full)
  - bato-character-profile.md (full)
  - stages/stage-1-active-listening.md

At each stage transition:
  - Swap current stage MD for the next stage MD
  - Example: stage-1-active-listening.md → stage-2-empathy.md
```

**Master Negotiator Agent context injection:**
```
At session start:
  - negotiator-master.md (full — used as system prompt)
  - No Bato context files needed (the agent is the one being scored, not the subject)
```

**Scoring engine context injection:**
```
At session end (after transcript is complete):
  - scoring-rubric.md (full)
  - Full conversation transcript
```

---

## Data Model: Sessions and Scores

Each negotiation session produces:

```json
{
  "session_id": "uuid",
  "mode": "training" | "benchmarking",
  "subject": "bato-dela-rosa",
  "date": "2026-05-27T12:00:00Z",
  "duration_minutes": 22,
  "final_stage_reached": 4,
  "outcome": "surrender_executed" | "disengaged" | "failed",
  "scores": {
    "stage_1_active_listening": 2,
    "stage_2_empathy": 3,
    "stage_3_rapport": 2,
    "stage_4_influence": 2,
    "stage_5_behavioral_change": 1,
    "total": 10
  },
  "stage_breakdowns": [
    {
      "stage": 1,
      "positive_indicators": ["open-ended questions", "paraphrasing"],
      "negative_indicators": ["interruption at min 12"],
      "narrative": "Strong active listening overall. Paraphrasing was accurate..."
    },
    ...
  ],
  "transcript": [
    {"speaker": "bato", "text": "...", "timestamp": "..."},
    {"speaker": "negotiator", "text": "...", "timestamp": "..."}
  ]
}
```

---

## Optional: Demo Mode Features

### Scenario Briefing Screen
Before a session starts, show a briefing screen with:
- Who Bato is (short bio)
- The situation (ICC warrant, fugitive, current status)
- The BCSM stages (visual diagram)
- Training tips (what to do and what to avoid per stage)

### Stage Progress Indicator
During a session, show a visual progress bar:
`[Stage 1] → [Stage 2] → [Stage 3] → [Stage 4] → [Stage 5]`
Highlight the current stage and mark when each was reached.

### Live Technique Feedback (Training Mode)
After each human utterance, display a small badge:
- "Active Listening ✓" — if appropriate Stage 1 technique was detected
- "Stage Violation ✗" — if the human attempted to move to influence too early

### Transcript Review
After a session, allow the user to replay the transcript with per-utterance scores annotated. Click on any utterance to see why it scored the way it did.

---

## Summary

The MD files in `docs/superpowers/bato/` form the complete content layer of the Bato dela Rosa negotiation training and benchmarking scenario:

- **Bato's identity and psychology** come from the biography, absences, and character profile files
- **Bato's stage-specific behavior** comes from the five stage files (with if-then branches for realistic responses)
- **The negotiator's technique** comes from the negotiator-master.md system prompt
- **The evaluation** comes from the scoring-rubric.md, which processes the transcript into per-stage scores with narrative breakdowns

Together, they create a self-contained, rich simulation for training humans and benchmarking autonomous agents in FBI BCSM negotiation methodology.