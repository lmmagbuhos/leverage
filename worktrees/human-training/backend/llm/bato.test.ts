import { describe, expect, test } from "vitest";
import { runBatoReply, transcriptToMessages } from "./bato";
import { LlmMessage, LlmProvider } from "./provider";

describe("transcriptToMessages", () => {
  test("maps negotiator to user and bato to assistant", () => {
    const msgs = transcriptToMessages([
      { speaker: "negotiator", text: "Can we talk?" },
      { speaker: "bato", text: "Who is this?" }
    ]);
    expect(msgs).toEqual([
      { role: "user", content: "Can we talk?" },
      { role: "assistant", content: "Who is this?" }
    ]);
  });
});

describe("runBatoReply", () => {
  test("sends system prompt + history and returns the completion", async () => {
    let seen: LlmMessage[] = [];
    const provider: LlmProvider = {
      async complete(messages) {
        seen = messages;
        return "I did what I was told.";
      },
      async *streamChat() {
        yield "";
      }
    };
    const reply = await runBatoReply(provider, "BATO PROMPT", [
      { role: "user", content: "You served thirty years." }
    ]);
    expect(reply).toBe("I did what I was told.");
    expect(seen[0]).toEqual({ role: "system", content: "BATO PROMPT" });
    expect(seen[1]).toEqual({ role: "user", content: "You served thirty years." });
  });
});
