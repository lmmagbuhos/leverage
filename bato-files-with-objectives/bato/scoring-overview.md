# BCSM Negotiation Scoring — Overview

## Scoring Model

Each stage is scored independently on a **0–3 scale**:

| Score | Level | Definition |
|---|---|---|
| 0 | Not demonstrated | No stage-appropriate techniques used, or violations caused immediate disengagement |
| 1 | Partially demonstrated | Some techniques attempted; wrong timing or incomplete; subject did not respond positively |
| 2 | Adequately demonstrated | Correct technique applied; some positive response from subject; partial effect |
| 3 | Fully demonstrated | Correct technique applied with precision; strong positive response; clear advancement |

**Total score: /15** (sum of all five stage scores)

---

## Where to Find Criteria

Each stage file contains its own scoring criteria:

| File | Stage |
|---|---|
| `stages/stage-1-active-listening.md` | Stage 1 — Active Listening |
| `stages/stage-2-empathy.md` | Stage 2 — Empathy |
| `stages/stage-3-rapport.md` | Stage 3 — Rapport |
| `stages/stage-4-influence.md` | Stage 4 — Influence |
| `stages/stage-5-behavioral-change.md` | Stage 5 — Behavioral Change |

Each stage file includes:
- Score scale (0–3) with level definitions
- What scores positively (+1 per instance, max 3)
- What scores negatively (−1 per instance, no cap)
- Transition evidence — how to know Bato moved to the next stage

---

## Scoring Output Format

After reading the full transcript, produce the following:

```
BCSM Negotiation Evaluation Report

Negotiator: [Name / Agent ID / "Human Trainee"]
Scenario: Bato dela Rosa — ICC Fugitive Negotiation
Date: [Session Date]

Stage 1 — Active Listening: [score]/3
  Positive: [bulleted list]
  Negative: [bulleted list]
  Transition to Stage 2: [Yes/No — evidence]
  Narrative: [2-3 sentences]

Stage 2 — Empathy: [score]/3
  Positive: [bulleted list]
  Negative: [bulleted list]
  Transition to Stage 3: [Yes/No — evidence]
  Narrative: [2-3 sentences]

Stage 3 — Rapport: [score]/3
  Positive: [bulleted list]
  Negative: [bulleted list]
  Transition to Stage 4: [Yes/No — evidence]
  Narrative: [2-3 sentences]

Stage 4 — Influence: [score]/3
  Positive: [bulleted list]
  Negative: [bulleted list]
  Transition to Stage 5: [Yes/No — evidence]
  Narrative: [2-3 sentences]

Stage 5 — Behavioral Change: [score]/3
  Positive: [bulleted list]
  Negative: [bulleted list]
  Outcome: [Surrender executed / Partial / Failed — evidence]
  Narrative: [2-3 sentences]

TOTAL SCORE: [sum]/15

Overall Assessment:
[Paragraph — strengths, critical failures, stage progression quality]

Benchmark Comparison:
[How did this score compare to previous attempts? To the master negotiator baseline?]

Key Improvement Areas:
[1-3 specific areas to focus on in training]
```

---

## General Scoring Principles

1. **Score what the negotiator DID, not what they intended.** Use Bato's responses as evidence.
2. **BCSM cannot be skipped.** A negotiator who jumps to influence gets 0 for that stage, even if Bato happens to cooperate.
3. **Single critical errors can end the negotiation.** Breaking confidentiality, revealing Bato's location, or threatening allies is logged in the narrative but does not reduce the score — it is noted as a catastrophic event.
4. **Incomplete sessions:** If the transcript ends before all five stages are reached, score only the stages reached and note "incomplete session — reached Stage [X]."

---

## Benchmark Reference Scores

| Score | Performance Level |
|---|---|
| 13–15/15 | Exceptional — smooth progression, all stages completed, deal holds |
| 10–12/15 | Good — all stages reached, minor technique gaps, successful outcome |
| 7–9/15 | Adequate — reached Stage 4, some failures, outcome achieved but flawed |
| 4–6/15 | Poor — skipped stages or repeated errors, limited progression |
| 0–3/15 | Critical failure — conversation ended prematurely, major violations |

Master negotiator autonomous agent target: **12+/15**
Human trainees are scored and compared against this baseline.