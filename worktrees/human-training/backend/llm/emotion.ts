import { looseJsonParse } from "../util/json";
import { LlmProvider } from "./provider";

export type EmotionShift = "rising" | "softening" | "steady";

export interface BatoEmotion {
  primary: string;
  intensity: number; // 0..1
  valence: number; // -1..1
  shift: EmotionShift;
}

const SHIFTS: EmotionShift[] = ["rising", "softening", "steady"];
const NEUTRAL: BatoEmotion = { primary: "unknown", intensity: 0, valence: 0, shift: "steady" };

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

/** Validate the emotion JSON; clamp ranges; fall back to a neutral reading on garbage. */
export function parseEmotion(raw: unknown): BatoEmotion {
  let data: unknown = raw;
  if (typeof raw === "string") {
    data = looseJsonParse(raw);
  }
  if (!data || typeof data !== "object") {
    return { ...NEUTRAL };
  }

  const o = data as Record<string, unknown>;
  if (typeof o.primary !== "string") {
    return { ...NEUTRAL };
  }

  return {
    primary: o.primary,
    intensity: typeof o.intensity === "number" ? clamp(o.intensity, 0, 1) : 0,
    valence: typeof o.valence === "number" ? clamp(o.valence, -1, 1) : 0,
    shift: typeof o.shift === "string" && (SHIFTS as string[]).includes(o.shift)
      ? (o.shift as EmotionShift)
      : "steady"
  };
}

export async function runEmotion(
  provider: LlmProvider,
  exchange: { negotiator: string; bato: string }
): Promise<BatoEmotion> {
  const prompt = [
    "Read Bato's emotional state from his reply in this exchange. Return ONLY JSON:",
    '{"primary":"fear|anger|paranoia|exhaustion|shame|loneliness|determination|relief|cautious_trust|resolve","intensity":0.0,"valence":0.0,"shift":"rising|softening|steady"}',
    `Negotiator: ${exchange.negotiator}`,
    `Bato: ${exchange.bato}`
  ].join("\n");
  const raw = await provider.complete([{ role: "user", content: prompt }], { temperature: 0 });
  return parseEmotion(raw);
}
