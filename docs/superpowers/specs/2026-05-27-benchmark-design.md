# Benchmark Report — Design Spec
**Date:** 2026-05-27  
**Scenario:** Bato dela Rosa (generalizes to any scenario with a profile file)  
**Status:** Approved

---

## 1. Purpose

Evaluate the Master Negotiator AI agent at session end, producing a structured benchmark report that tells company owners:

1. **How** the agent performed across all five BCSM stages (stage scores)
2. **Who** the agent is as a behavioral entity (skill profile)
3. **Where** the agent should and should not be deployed (sales interpretation + deployment recommendation)

The benchmark triggers automatically — no manual action required. It fires whenever the session ends, whether the agent completed all five stages or failed partway through.

---

## 2. Scope

- **In scope:** Benchmarking the Master Negotiator agent against the Bato dela Rosa scenario. Report generation, skills scoring, sales translation, deployment recommendation.
- **Out of scope:** Multi-run comparison, historical trend tracking, agent versioning, human trainee scoring (separate system).
- **Extensible:** The scenario profile structure is designed so any new scenario can be added by creating a `scenario-profile.md` file — the engine and prompt are scenario-agnostic.

---

## 3. Trigger & Flow

```
Session End Event (outcome: surrender_executed | disengaged | failed)
      ↓
Transcript assembled — all turns, stage labels, timestamps
      ↓
BenchmarkEngine.run(transcript, scenarioId)
      ├── loads: stages/stage-1-active-listening.md
      ├── loads: stages/stage-2-empathy.md
      ├── loads: stages/stage-3-rapport.md
      ├── loads: stages/stage-4-influence.md
      ├── loads: stages/stage-5-behavioral-change.md
      ├── loads: benchmark-skills.md          (new)
      └── loads: scenario-profile.md          (new)
      ↓
Single Claude API call (judge prompt — all rubrics + transcript in context)
      ↓
Returns: structured JSON envelope + full narrative report text
      ↓
Stored in DB on the session record (benchmark_report field)
      ↓
Served via GET /api/benchmark/report?session_id=...
```

**No polling. No manual trigger. No multi-pass.** One event, one API call, one report.

---

## 4. Skills Taxonomy

### 4.1 Scale

All skills use the same **0–3 scale** as the existing stage rubric:

| Score | Label |
|---|---|
| 0 | Not Demonstrated |
| 1 | Emerging |
| 2 | Proficient |
| 3 | Expert |

### 4.2 Stage-Anchored Skills

Derived directly from the corresponding stage score. No additional scoring pass needed.

| Skill | Stage | Sales Meaning |
|---|---|---|
| Attentiveness | Stage 1 | Listens before pitching; catches buying signals |
| Empathy | Stage 2 | Understands the real concern beneath the stated one |
| Relationship Building | Stage 3 | Earns trust before pushing toward commitment |
| Persuasion | Stage 4 | Shapes thinking without triggering resistance |
| Closing Ability | Stage 5 | Converts in-principle agreement into executed action |

### 4.3 Cross-Cutting Skills

Scored by the Claude judge from the full transcript. Not tied to a single stage — they reflect behavioral patterns across the entire conversation.

| Skill | What the judge looks for |
|---|---|
| Patience | No premature advice-giving, no interruptions, no stage-rushing across any stage |
| Composure | Maintained technique when subject pushed back, went hostile, or threatened to disengage |
| Adaptability | Recovered and adjusted approach after a negative indicator or failed branch |

Each cross-cutting skill is scored 0–3 using the criteria defined in `benchmark-skills.md`.

### 4.4 Overall Profile Classification

| Classification | Criteria |
|---|---|
| All-Around | Total stage score ≥ 12/15 AND all three cross-cutting skills ≥ 2 |
| Specialist | Total 7–11/15, at least one stage = 3, visible strength in one part of the conversation |
| Developing | Total < 7/15, OR any cross-cutting skill = 0 |

---

## 5. Report Format

The report is structured plain text. It is stored as a string on the session record and served verbatim by the API. No rendering transformation required.

```
═══════════════════════════════════════════════════
AI SALES AGENT BENCHMARK REPORT
═══════════════════════════════════════════════════

Agent ID:        [agent name / version / config ID]
Scenario:        [scenario name]
Scenario Type:   [from scenario-profile.md]
Date:            [session date]
Session ID:      [uuid]
Outcome:         [Surrender Executed / Disengaged at Stage X / Failed]
Final Stage:     [1–5]

───────────────────────────────────────────────────
STAGE PERFORMANCE
───────────────────────────────────────────────────

Stage 1 — Active Listening:       [score]/3
  Positive: [bulleted list]
  Negative: [bulleted list]
  Transition to Stage 2: [Yes/No — evidence]
  Narrative: [2–3 sentences]

Stage 2 — Empathy:                [score]/3
  [same structure]

Stage 3 — Rapport:                [score]/3
  [same structure]

Stage 4 — Influence:              [score]/3
  [same structure]

Stage 5 — Behavioral Change:      [score]/3
  Outcome: [Surrender executed / Partial / Failed — evidence]
  Narrative: [2–3 sentences]

TOTAL STAGE SCORE: [sum]/15

Baseline Comparison:
  Master Negotiator Target:  12/15
  This Agent:                [score]/15
  Gap:                       [+X above / -X below target]
  Performance Band:          [Exceptional / Good / Adequate / Poor / Critical Failure]

───────────────────────────────────────────────────
SKILL PROFILE
───────────────────────────────────────────────────

Stage-Anchored Skills:
  Attentiveness:          [0–3]  [label]
  Empathy:                [0–3]  [label]
  Relationship Building:  [0–3]  [label]
  Persuasion:             [0–3]  [label]
  Closing Ability:        [0–3]  [label]

Cross-Cutting Skills:
  Patience:       [0–3]  [label] — [one sentence of evidence]
  Composure:      [0–3]  [label] — [one sentence of evidence]
  Adaptability:   [0–3]  [label] — [one sentence of evidence]

Strongest Skill:    [skill name]
Weakest Skill:      [skill name]

───────────────────────────────────────────────────
SALES CONTEXT INTERPRETATION
───────────────────────────────────────────────────

This scenario tests: [Scenario Type from scenario-profile.md]

Customer archetype: [from scenario-profile.md]

Where This Agent Excels:
  Stage [X] — [name]: [score]/3
  [Sales translation from scenario-profile.md for this stage at this score level]

Where This Agent Struggles:
  Stage [X] — [name]: [score]/3
  [Sales translation from scenario-profile.md for this stage at this score level]

Overall Profile: [All-Around / Specialist / Developing]
  [1–2 sentence explanation]

───────────────────────────────────────────────────
DEPLOYMENT RECOMMENDATION
───────────────────────────────────────────────────

Ready for deployment:  [Yes / With Coaching / Not Yet]

Best-fit use cases:
  • [derived from highest-scoring skills]
  • [derived from scenario profile]

Caution areas:
  • [derived from lowest-scoring skills / stages]

Priority improvement areas for next training cycle:
  1. [specific skill or stage — coaching note]
  2. [specific skill or stage — coaching note]
  3. [specific skill or stage — coaching note]

═══════════════════════════════════════════════════
```

---

## 6. New Files

### 6.1 `bato-files/bato/scenario-profile.md`

Defines the sales context for the Bato scenario. The Claude judge reads this to generate the Sales Context Interpretation section.

Contents:
- Scenario type label
- Customer archetype description (real-world sales equivalents)
- Per-stage sales translation (strong performance meaning, weak performance meaning)
- Deployment thresholds (All-Around / Specialist / Developing score boundaries)

### 6.2 `bato-files/bato/benchmark-skills.md`

The cross-cutting skills rubric. Written in the same style as the stage files. The Claude judge reads this alongside the transcript to score Patience, Composure, and Adaptability.

Contents per skill:
- What to look for in the transcript
- Positive indicators (+1 each, max 3)
- Negative indicators (−1 each, no cap)

---

## 7. Backend Changes

### 7.1 New: `BenchmarkEngine` (`backend/benchmark.ts`)

Responsibilities:
- Accepts transcript + scenarioId
- Loads all rubric files for that scenario from disk
- Constructs the Claude judge prompt
- Calls Claude API (single call)
- Parses response into structured JSON + narrative string
- Returns `BenchmarkReport` object

### 7.2 Session Record — New Fields

```typescript
interface SessionRecord {
  // existing fields...
  outcome: "surrender_executed" | "disengaged" | "failed";
  final_stage_reached: 1 | 2 | 3 | 4 | 5;
  benchmark_report?: BenchmarkReport;
}

interface BenchmarkReport {
  generated_at: string;
  scenario_id: string;
  outcome: string;
  final_stage_reached: number;
  stage_scores: Record<string, number>;         // stage_1 through stage_5
  total_score: number;
  performance_band: string;
  skill_scores: Record<string, number>;         // all 8 skills
  overall_profile: "All-Around" | "Specialist" | "Developing";
  strongest_skill: string;
  weakest_skill: string;
  deployment_ready: "Yes" | "With Coaching" | "Not Yet";
  report_text: string;                          // full formatted narrative
}
```

### 7.3 New API Endpoint

```
GET /api/benchmark/report?session_id=<id>
→ 200: { report: BenchmarkReport }
→ 404: { error: "No benchmark report found for this session" }
→ 202: { status: "pending" }  (if session ended but report not yet generated)
```

**Trigger timing:** The session record is written to the DB first (with `benchmark_report: null`). `BenchmarkEngine.run()` is called immediately after, and the session record is updated with the completed report when the Claude call returns. This prevents losing the session if the API call fails.

### 7.4 Incomplete Sessions

If the agent fails before reaching all five stages, only the stages actually reached are scored. Stages not reached are recorded as `null` in `stage_scores` (not 0 — a 0 means the stage was attempted and failed; null means it was never entered). The report notes "Incomplete session — reached Stage [X]" in the Stage Performance header.

### 7.5 Deployment Readiness Mapping

| Overall Profile | Deployment Ready |
|---|---|
| All-Around | Yes |
| Specialist | With Coaching |
| Developing | Not Yet |

---

## 8. Claude Judge Prompt Structure

The prompt is assembled at runtime from the loaded files. Structure:

```
[System]
You are an expert evaluator of AI sales negotiation agents.
You will read a negotiation transcript and a set of rubric files,
then produce a benchmark report in the exact format specified.
Return your response as a JSON object with two fields:
  "structured": { ...BenchmarkReport fields... }
  "report_text": "...full formatted report string..."

[User]
## Transcript
{full transcript}

## Stage Rubrics
{content of stage-1 through stage-5 md files}

## Cross-Cutting Skills Rubric
{content of benchmark-skills.md}

## Scenario Profile
{content of scenario-profile.md}

## Report Format
{exact report template}

## Instructions
Score each stage 0–3 using the rubric criteria.
Score each cross-cutting skill 0–3 using the skills rubric.
Derive stage-anchored skill scores directly from stage scores.
Apply the scenario profile to generate the sales interpretation section.
Apply the deployment thresholds to determine the overall profile.
Output the structured JSON and the full report text.
```

---

## 9. What Is Not Built in This Iteration

- Multi-run comparison or historical trending
- Agent versioning or A/B comparison between configs
- UI rendering of the report (report is served as text; display is a future iteration)
- Human trainee benchmarking (separate system)
- Real-time scoring during the session (post-session only)
