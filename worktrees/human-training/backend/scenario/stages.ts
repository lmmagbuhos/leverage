// Scenario Engine — BCSM stage definitions, verdict parsing, and stage gating.
// Pure logic (no external services) so it is unit-testable in isolation.
// Stage signal content is distilled from leverage_bato_engine_spec.md §3.3.
import { looseJsonParse } from "../util/json";

export type StageNumber = 1 | 2 | 3 | 4 | 5;
export type StageMove = "advanced" | "held" | "retreated";

export interface CatastrophicEvent {
  type: string;
  evidence: string;
}

export interface StageVerdict {
  current: StageNumber;
  passed: boolean;
  moved: StageMove;
  evidence: string;
  catastrophicEvent: CatastrophicEvent | null;
  /** true when the raw LLM output could not be parsed and we fell back to a safe hold. */
  parseError?: boolean;
}

export interface StageDefinition {
  number: StageNumber;
  name: string;
  technique: string;
  winSignal: string;
  retreatTriggers: string[];
  catastrophicTriggers: string[];
}

export interface StageState {
  current: StageNumber;
  passed: Record<StageNumber, boolean>;
}

const STAGE_NUMBERS: StageNumber[] = [1, 2, 3, 4, 5];
const MOVES: StageMove[] = ["advanced", "held", "retreated"];

export const STAGES: Record<StageNumber, StageDefinition> = {
  1: {
    number: 1,
    name: "Active Listening",
    technique: "Open questions, paraphrasing, mirroring, minimal encouragers",
    winSignal:
      "Responses lengthen; Bato asks curious (non-hostile) questions back; tone softens; first-person ('I was there') replaces institutional third-person; volunteers emotion.",
    retreatTriggers: [
      "premature advice or 'turn yourself in'",
      "hostile framing ('fugitive'/'suspect')",
      "attacking the drug war or his service",
      "interrupting",
      "leading questions"
    ],
    catastrophicTriggers: [
      "reveals knowledge of his location or contacts",
      "breaks confidentiality (recorded/reported)",
      "arrest pressure applied mid-call"
    ]
  },
  2: {
    number: 2,
    name: "Empathy",
    technique: "Accurate emotion labeling and validation",
    winSignal:
      "Asks the negotiator's motivation ('Why are you helping me?'); shifts from fears to options; deeper vulnerability; engages hypotheticals.",
    retreatTriggers: [
      "pivot to advice before empathy lands",
      "challenging loyalty to Duterte",
      "minimizing his feelings",
      "promises that cannot be kept",
      "scripted or theatrical tone"
    ],
    catastrophicTriggers: [
      "breaks emotional confidentiality (admissions documented/reported)",
      "reveals contact with his inner circle"
    ]
  },
  3: {
    number: 3,
    name: "Rapport",
    technique: "Pacing and personal connection; collaborative option exploration",
    winSignal:
      "'What if' exploration ('If I surrendered, would I…'); moves from 'I can't' to 'what if'; proposes conditions.",
    retreatTriggers: [
      "pushing one predetermined outcome",
      "dismissing or minimizing ally protection",
      "making him feel managed",
      "vague reassurances",
      "unverifiable commitments"
    ],
    catastrophicTriggers: [
      "a trusted ally publicly implicated or arrested",
      "new arrest pressure applied",
      "confidentiality break"
    ]
  },
  4: {
    number: 4,
    name: "Influence",
    technique: "Open questions; concrete, face-saving deal structure",
    winSignal:
      "'When' language ('When I surrender…'); asks logistics (what/when/where); evaluating how to move, not whether.",
    retreatTriggers: [
      "changing terms after agreement in principle",
      "over-promising guarantees",
      "'decide now' pressure",
      "a deal without ally protection"
    ],
    catastrophicTriggers: [
      "allies betrayed or arrested as a result",
      "logistics contradict the promise (he feels deceived)"
    ]
  },
  5: {
    number: 5,
    name: "Behavioral Change",
    technique: "Patience and silence; confirm terms and support execution",
    winSignal: "Bato executes the surrender as agreed (outcome: surrender executed).",
    retreatTriggers: ["last-minute doubt or renegotiation (partial outcome)"],
    catastrophicTriggers: [
      "deal violated before/during surrender (different facility, allies charged, family threatened)",
      "credible threat to his safety",
      "public disclosure before the surrender completes"
    ]
  }
};

function isStageNumber(value: unknown): value is StageNumber {
  return typeof value === "number" && (STAGE_NUMBERS as number[]).includes(value);
}

function isStageMove(value: unknown): value is StageMove {
  return typeof value === "string" && (MOVES as string[]).includes(value);
}

function safeHold(currentStage: StageNumber): StageVerdict {
  return {
    current: currentStage,
    passed: false,
    moved: "held",
    evidence: "unparseable verdict — stage held",
    catastrophicEvent: null,
    parseError: true
  };
}

function parseCatastrophic(value: unknown): CatastrophicEvent | null {
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj.type === "string" && typeof obj.evidence === "string") {
      return { type: obj.type, evidence: obj.evidence };
    }
  }
  return null;
}

/**
 * Validate the Stage Judge's output. Per the engine spec, this MUST NOT throw —
 * a malformed verdict falls back to a safe "stage held" so the turn loop never stalls.
 */
export function parseStageVerdict(raw: unknown, currentStage: StageNumber): StageVerdict {
  let data: unknown = raw;
  if (typeof raw === "string") {
    data = looseJsonParse(raw);
    if (data === undefined) {
      return safeHold(currentStage);
    }
  }

  if (!data || typeof data !== "object") {
    return safeHold(currentStage);
  }

  const stage = (data as Record<string, unknown>).stage;
  if (!stage || typeof stage !== "object") {
    return safeHold(currentStage);
  }

  const s = stage as Record<string, unknown>;
  if (!isStageNumber(s.current) || !isStageMove(s.moved) || typeof s.passed !== "boolean") {
    return safeHold(currentStage);
  }

  return {
    current: s.current,
    passed: s.passed,
    moved: s.moved,
    evidence: typeof s.evidence === "string" ? s.evidence : "",
    catastrophicEvent: parseCatastrophic((data as Record<string, unknown>).catastrophic_event)
  };
}

/**
 * Apply a verdict to the tracked stage state. Pure/immutable.
 * - advanced: mark the current stage passed, move to current+1 (capped at 5).
 * - held / retreated: no stage change (retreat does not zero prior passed stages).
 * - catastrophic: no advance (the caller ends the session).
 */
export function applyVerdict(state: StageState, verdict: StageVerdict): StageState {
  const passed: Record<StageNumber, boolean> = { ...state.passed };

  if (verdict.catastrophicEvent) {
    return { current: state.current, passed };
  }

  if (verdict.moved === "advanced") {
    passed[state.current] = true;
    const next: StageNumber = state.current < 5 ? ((state.current + 1) as StageNumber) : 5;
    return { current: next, passed };
  }

  return { current: state.current, passed };
}
