import { describe, expect, test } from "vitest";
import { buildJoinBody } from "./agent";

describe("buildJoinBody", () => {
  test("embeds the session id in the custom-LLM URL path (the routing key)", () => {
    const body = buildJoinBody({
      channel: "leverage-room",
      agentRtcToken: "tok",
      llmBaseUrl: "https://host.example",
      sessionId: "abc-123"
    });
    const llm = (body.properties.llm as { url: string });
    expect(body.name).toBe("abc-123");
    expect(llm.url).toBe("https://host.example/api/llm/abc-123/chat/completions");
  });

  test("carries channel, token, greeting, and tts voice", () => {
    const body = buildJoinBody({
      channel: "c",
      agentRtcToken: "t",
      llmBaseUrl: "https://h",
      sessionId: "s",
      greeting: "You don't know me, but I'd like to listen.",
      ttsVoice: "fil-PH-SomeVoice"
    });
    expect(body.properties.channel).toBe("c");
    expect(body.properties.token).toBe("t");
    expect((body.properties.llm as { greeting_message: string }).greeting_message).toMatch(/listen/);
    expect((body.properties.tts as { params: { voice_name: string } }).params.voice_name).toBe(
      "fil-PH-SomeVoice"
    );
  });
});
