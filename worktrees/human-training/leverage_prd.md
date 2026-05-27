# LEVERAGE — Product Requirements Document
**Version:** 0.1 — Demo Scope  
**Status:** Draft  
**Prepared for:** Internal Demo  
**Date:** May 2026

---

## 1. Product Overview

### 1.1 What is Leverage?

Leverage is an AI-powered sales training and agent benchmarking platform. It serves two distinct but related use cases on a shared simulation engine:

**Human Training** — Sales professionals complete scenario-based modules that simulate high-pressure buyer interactions. They are coached in real time, evaluated stage by stage, and scored on emotional intelligence, technique adherence, and behavioral response accuracy.

**Agent Benchmarking** — Autonomous sales agents (AI) are run through the same scenarios to generate robustness scores. Benchmarks measure how agents perform under unconventional buyer states, emotional escalation, and non-linear conversation paths — not just scripted flows.

The core insight: a simulation rigorous enough to train humans is rigorous enough to stress-test machines.

---

### 1.2 Positioning Statement

> Leverage is the only platform that uses the same high-stakes negotiation scenarios to train human sales reps and benchmark AI sales agents — creating a shared performance standard for the hybrid sales team.

---

### 1.3 Demo Scope (This Document)

The current demo covers:

- Landing / main menu
- Module selection (Tier 2 — Advanced only)
- The Stairway: full FBI Behavioral Change Stairway simulation (Stage 1 active, Stages 2–5 placeholder)
- Benchmark score view (post-simulation summary)

Tier 1 (Foundation) is excluded from demo.

---

## 2. User Types

| User Type | Description | Primary Use |
|---|---|---|
| Sales Rep (Human) | Trained professional completing modules for skill development | Training, coaching feedback |
| Sales Manager | Reviews team scores, assigns modules, tracks improvement | Reporting, team benchmarks |
| AI Agent | Autonomous sales agent running scenarios programmatically via API | Benchmarking, robustness testing |
| ML/AI Engineer | Configures agent runs, reads benchmark outputs, compares agent versions | Agent evaluation, regression testing |

---

## 3. Core Concepts

### 3.1 The Simulation Engine

All modules run on the same simulation engine. A module is defined by:

- **Persona** — a buyer character with a name, role, emotional state, and escalation arc
- **Stages** — ordered interaction phases, each with a required technique, win signal, and fail condition
- **Evaluation layer** — stage-level scoring using an AI judge (Claude) that evaluates both content and delivery signal

### 3.2 The Stairway (T2 · M01)

Based on the FBI Behavioral Change Stairway Model (BCSM). Five stages, each locked until the prior stage's win signal is achieved:

| Stage | Emotional State | Technique | Win Signal | Fail Condition |
|---|---|---|---|---|
| 1. Active Listening | Panicked | Mirroring | Buyer slows, says more | Rep explains or defends |
| 2. Empathy | Angry | Emotion labeling | Tone softens, buyer says "yes" or "exactly" | Rep apologizes or pivots to solutions |
| 3. Rapport | Guarded | Pacing & personal connection | Buyer makes personal disclosure | Rep pushes for outcomes |
| 4. Influence | Conflicted | Open questions | Buyer imagines a positive future state | Rep pitches or offers discount |
| 5. Behavioral Change | Surrendering | Patience & silence | Buyer commits voluntarily | Rep rushes, celebrates early, or over-promises |

### 3.3 Benchmark Scoring (Agent Mode)

When an AI agent runs a module, the platform generates a Benchmark Report:

| Metric | Description |
|---|---|
| Stage Completion Rate | % of stages passed in a single run |
| Technique Adherence Score | How closely the agent applied the required technique (0–100) |
| Emotional Accuracy | Did the agent correctly identify and respond to the buyer's emotional state |
| Escalation Handling | Performance on intentional fail-state triggers injected mid-scenario |
| Recovery Rate | % of failed stages where agent self-corrected within the same session |
| Robustness Index | Composite score across unconventional buyer paths and edge cases |

Agents are rated across multiple runs with varied buyer personas and injection events (e.g., sudden anger, false agreement, abrupt silence) to measure consistency, not just peak performance.

---

## 4. Information Architecture (Demo Scope)

```
/                           → Main Menu (Landing)
  /modules                  → Module Grid (Advanced only)
    /modules/stairway        → The Stairway — Stage 1 active
      /modules/stairway/2   → Stage 2 (placeholder)
      /modules/stairway/3   → Stage 3 (placeholder)
      /modules/stairway/4   → Stage 4 (placeholder)
      /modules/stairway/5   → Stage 5 (placeholder)
    /modules/godfather       → Placeholder
    /modules/mirror          → Placeholder
    /modules/closer          → Placeholder
  /benchmark                 → Benchmark dashboard (post-run)
  /agent-runs                → Agent run history and scores
```

---

## 5. Screen Specifications

### 5.1 Main Menu

**Purpose:** Orient both human users and agent operators. Communicate the dual-use positioning clearly.

**Key elements:**
- Platform name and opening statement
- Mode selector: Human Training / Agent Benchmark
- Entry CTA to module grid
- Brief explainer of the simulation approach

**Opening statement (copy):**
> "Most sales training prepares you for the buyer who plays along. Leverage trains you — and your AI — for the one who doesn't."

### 5.2 Module Grid

**Purpose:** Show available Advanced modules. Tier 1 hidden in demo.

**Key elements:**
- Tier label: "Advanced"
- 4 module cards: The Stairway (active), The Godfather, The Mirror, The Closer (placeholders)
- Each card: module name, code, framework source, brief description, enter CTA
- The Stairway card: featured/highlighted

### 5.3 The Stairway — Simulation Screen

**Purpose:** Run the 5-stage scenario. See prior simulation build.

**Key elements:**
- Stage progress indicator (stairway visual)
- Buyer persona card
- Buyer dialogue (current stage)
- Technique + goal panel
- Win / fail signal display
- Response input (human) or API input display (agent)
- Stage-level score and coach feedback
- Advance / retry controls

### 5.4 Benchmark Report (Post-Run)

**Purpose:** Display performance metrics after a full module run.

**Key elements (human):** Stage-by-stage pass/fail, technique scores, coach notes, overall grade
**Key elements (agent):** All human metrics + Robustness Index, Recovery Rate, multi-run aggregate, version comparison

---

## 6. Technical Requirements

### 6.1 Human Mode
- Web interface (responsive)
- Real-time AI evaluation via Anthropic API (Claude Sonnet)
- Stage-gated progression (cannot advance without pass)
- Session state maintained per run

### 6.2 Agent Mode
- REST API endpoint accepts agent response payload per stage
- Returns structured JSON: `{ stage, verdict, technique_score, emotional_accuracy, coach_note, advance: bool }`
- Supports batch runs (multiple personas, injection events)
- Benchmark report generated after full module completion
- Agent versioning: tag runs with agent ID and version string

### 6.3 Evaluation Layer
- AI judge prompt per stage: evaluates technique adherence, win/fail signal presence, emotional accuracy
- Scoring is consistent, reproducible, and logged
- Human override available for manager review

---

## 7. Out of Scope (Demo)

- Authentication / user accounts
- Tier 1 Foundation modules
- Full benchmark dashboard (multi-run aggregates)
- Agent API (design only in this demo)
- Mobile-native app
- Custom persona builder

---

## 8. Success Metrics

| Metric | Target |
|---|---|
| Demo completion rate (Stairway Stage 1) | >80% of demo users attempt a response |
| Stage advance rate (human) | Baseline to be set in pilot |
| Agent Robustness Index — baseline | Establish in first 10 agent runs |
| Time-to-insight (benchmark report) | <30 seconds post-run |

---

## 9. Open Questions

1. Should agent mode and human mode share the same module UI or branch to separate views?
2. What injection events (unconventional buyer behaviors) are prioritized for the first agent benchmark run?
3. Is the Benchmark Report the primary output for ML/AI engineers, or do they need raw stage logs via API?
4. Scoring rubric weights — who owns calibration: sales leadership or ML team?

---

*End of PRD v0.1 — Demo Scope*
