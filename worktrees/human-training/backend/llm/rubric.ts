import { StageNumber } from "../scenario/stages";
import { looseJsonParse } from "../util/json";
import { LlmProvider } from "./provider";

export interface StageScore {
  stage: StageNumber;
  score: number; // 0..3
  positives: string[];
  negatives: string[];
}

export interface RubricResult {
  perStage: StageScore[];
  total15: number; // 0..15
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : [];
}

export function parseRubric(raw: unknown): RubricResult {
  let data: unknown = raw;
  if (typeof raw === "string") {
    data = looseJsonParse(raw);
  }
  if (!data || typeof data !== "object") {
    return { perStage: [], total15: 0 };
  }

  const o = data as Record<string, unknown>;
  const arr = Array.isArray(o.per_stage) ? o.per_stage : [];
  const perStage: StageScore[] = [];
  for (const item of arr) {
    if (item && typeof item === "object") {
      const it = item as Record<string, unknown>;
      if (typeof it.stage === "number" && it.stage >= 1 && it.stage <= 5) {
        perStage.push({
          stage: it.stage as StageNumber,
          score: typeof it.score === "number" ? clamp(Math.round(it.score), 0, 3) : 0,
          positives: stringArray(it.positives),
          negatives: stringArray(it.negatives)
        });
      }
    }
  }

  const total15 =
    typeof o.total_15 === "number"
      ? clamp(Math.round(o.total_15), 0, 15)
      : perStage.reduce((sum, s) => sum + s.score, 0);

  return { perStage, total15 };
}

export async function runRubric(
  provider: LlmProvider,
  transcript: { speaker: string; text: string }[]
): Promise<RubricResult> {
  const convo = transcript.map((t) => `${t.speaker}: ${t.text}`).join("\n");
  const prompt = [
    "You are a BCSM evaluator. Score the negotiator 0-3 on each of the 5 stages (1 Active Listening, 2 Empathy, 3 Rapport, 4 Influence, 5 Behavioral Change).",
    'Return ONLY JSON {"per_stage":[{"stage":1,"score":0,"positives":[],"negatives":[]}],"total_15":0}.',
    "TRANSCRIPT:",
    convo
  ].join("\n");
  return parseRubric(await provider.complete([{ role: "user", content: prompt }], { temperature: 0 }));
}
