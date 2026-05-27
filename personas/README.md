# BCSM Sales Personas

This directory contains the persona system prompts used by the Leverage benchmark runner. Each persona applies a different sales, influence, or negotiation methodology to the same Bato dela Rosa BCSM scenario.

The backend loads these files at startup from `backend/benchmark.ts` and exposes them as selectable presets through `GET /api/benchmark/presets`. The frontend renders them on `/benchmark`.

## Persona Files

| File | Preset ID | Persona | Core Philosophy | BCSM Fit |
|---|---|---|---|---|
| `chris-voss.md` | `chris-voss` | Chris Voss | Tactical empathy, mirroring, labeling, calibrated questions | Highest |
| `dale-carnegie.md` | `dale-carnegie` | Dale Carnegie | Relationship-first trust, genuine interest, saving face | High |
| `zig-ziglar.md` | `zig-ziglar` | Zig Ziglar | Selling is serving, belief-building, LQET objection handling | High |
| `tony-robbins.md` | `tony-robbins` | Tony Robbins | State-story-strategy, reframing, high-certainty influence | High |
| `jordan-belfort.md` | `jordan-belfort` | Jordan Belfort | Straight Line Selling, certainty transfer, looping objections | Moderate |
| `grant-cardone.md` | `grant-cardone` | Grant Cardone | 10X conviction, urgency, assumptive close | Low-to-moderate |

## Comparison Matrix

| Persona | Listening | Empathy | Rapport | Influence | Close | Energy Style |
|---|---|---|---|---|---|---|
| Chris Voss | 5/5 | 5/5 | 5/5 | 4/5 | 4/5 | Calm, tactical, low-arousal |
| Dale Carnegie | 5/5 | 5/5 | 5/5 | 4/5 | 4/5 | Warm, patient, relationship-first |
| Zig Ziglar | 5/5 | 4/5 | 5/5 | 4/5 | 4/5 | Warm, optimistic, service-led |
| Tony Robbins | 4/5 | 4/5 | 4/5 | 5/5 | 5/5 | High-energy, reframing-heavy |
| Jordan Belfort | 4/5 | 3/5 | 4/5 | 3/5 | 4/5 | Controlled authority |
| Grant Cardone | 2/5 | 2/5 | 3/5 | 4/5 | 4/5 | Bold, direct, relentless |

## BCSM Compatibility

Highest fit:

- Chris Voss: closest to FBI-style crisis negotiation; naturally matches BCSM sequencing.
- Dale Carnegie: strong listening and rapport base; low risk of premature pressure.

Strong fit with calibration:

- Zig Ziglar: strong service orientation and trust-building; may need more direct influence late.
- Tony Robbins: strong state management and reframing; must stay calibrated in crisis tone.

Higher-risk fit:

- Jordan Belfort: useful certainty mechanics, but must avoid accelerating the timeline.
- Grant Cardone: useful conviction and closing energy, but highest risk of skipping active listening and empathy.

## Prompt Structure

Each persona file includes:

- Role definition
- Core methodology
- Stage-by-stage BCSM mapping
- Sample language for all five stages
- Voice and tonality guidance
- Failure modes to avoid
- Expected scoring tendencies

The benchmark injects the current stage objective into the selected persona prompt for each agent turn. The persona should speak directly to Bato in 2-4 sentences and stay inside the scenario.

## Running Persona Benchmarks

Start the backend first:

```bash
npm run dev:backend
```

Then run all personas:

```bash
cd backend
bash run-personas.sh
```

Force fresh live runs instead of reusing canonical replay data:

```bash
cd backend
bash run-personas.sh --force
```

Saved runs are written to:

```text
persona-history/<persona-id>/
  session.json      # replayable full run
  benchmark.json    # final scoring result
  transcript.md     # human-readable conversation
```

## Adding a Persona

1. Add `personas/<persona-id>.md`.
2. Register the ID in `PERSONA_IDS` inside `backend/benchmark.ts`.
3. Add the display label and description in `PERSONA_LABELS` and `PERSONA_DESCRIPTIONS`.
4. Restart the backend so the prompt file is loaded.
5. Confirm it appears in `GET /api/benchmark/presets` and on `/benchmark`.
