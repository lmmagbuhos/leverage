import { looseJsonParse, stripThink } from "../util/json";
import { LlmProvider } from "./provider";

export interface PressItem {
  headline: string;
  body: string;
}

export interface CoachingItem {
  note: string;
  technique: string;
}

export function parsePress(raw: unknown): PressItem {
  const data = typeof raw === "string" ? looseJsonParse(raw) : raw;
  if (data && typeof data === "object") {
    const o = data as Record<string, unknown>;
    if (typeof o.headline === "string" && typeof o.body === "string") {
      return { headline: o.headline, body: o.body };
    }
  }
  return { headline: "", body: typeof raw === "string" ? stripThink(raw) : "" };
}

export function parseCoaching(raw: unknown): CoachingItem {
  const data = typeof raw === "string" ? looseJsonParse(raw) : raw;
  if (data && typeof data === "object") {
    const o = data as Record<string, unknown>;
    if (typeof o.note === "string") {
      return { note: o.note, technique: typeof o.technique === "string" ? o.technique : "" };
    }
  }
  return { note: typeof raw === "string" ? stripThink(raw) : "", technique: "" };
}

export async function runPress(
  provider: LlmProvider,
  ctx: { transcriptTail: string; stage: number }
): Promise<PressItem> {
  const prompt = [
    'You are an in-world Philippine political press desk. React to the latest development in 1-2 sentences as a news blurb. Return ONLY JSON {"headline":"...","body":"..."}.',
    `Stage ${ctx.stage}. Recent exchange:`,
    ctx.transcriptTail
  ].join("\n");
  return parsePress(await provider.complete([{ role: "user", content: prompt }], { temperature: 0.7 }));
}

export async function runCoaching(
  provider: LlmProvider,
  ctx: { negotiator: string; bato: string; stage: number; emotion?: string }
): Promise<CoachingItem> {
  const prompt = [
    'You are a BCSM negotiation coach. In one sentence, tell the human how their last move and delivery affected Bato. Return ONLY JSON {"note":"...","technique":"..."}.',
    `Stage ${ctx.stage}. Bato emotion: ${ctx.emotion ?? "unknown"}.`,
    `Negotiator: ${ctx.negotiator}`,
    `Bato: ${ctx.bato}`
  ].join("\n");
  return parseCoaching(await provider.complete([{ role: "user", content: prompt }], { temperature: 0.4 }));
}
