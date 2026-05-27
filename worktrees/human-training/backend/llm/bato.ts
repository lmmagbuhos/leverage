import { LlmMessage, LlmProvider } from "./provider";

/**
 * Build the message list for Bato (Call A): our per-stage system prompt followed by
 * the conversation (any inbound system messages are discarded — the per-stage prompt
 * is authoritative).
 */
export function buildBatoMessages(
  systemPrompt: string,
  conversation: LlmMessage[]
): LlmMessage[] {
  const turns = conversation.filter((m) => m.role !== "system");
  return [{ role: "system", content: systemPrompt }, ...turns];
}

/** Map a stored transcript to chat messages (negotiator → user, Bato → assistant). */
export function transcriptToMessages(
  transcript: { speaker: "negotiator" | "bato"; text: string }[]
): LlmMessage[] {
  return transcript.map((t) => ({
    role: t.speaker === "negotiator" ? "user" : "assistant",
    content: t.text
  }));
}

/** Non-streaming Bato reply (used by the text-mode demo path). */
export async function runBatoReply(
  provider: LlmProvider,
  systemPrompt: string,
  history: LlmMessage[]
): Promise<string> {
  return provider.complete(buildBatoMessages(systemPrompt, history), { temperature: 0.8 });
}
