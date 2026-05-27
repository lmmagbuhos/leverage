import { describe, expect, test } from "vitest";
import { LlmMessage, LlmProvider } from "./provider";
import { buildBatoMessages } from "./bato";
import { runStageJudge } from "./judge";
import { parseEmotion, runEmotion } from "./emotion";

function fakeProvider(canned: string): LlmProvider {
  return {
    async complete() {
      return canned;
    },
    async *streamChat() {
      yield canned;
    }
  };
}

describe("buildBatoMessages", () => {
  test("prepends our system prompt and drops the engine's system messages", () => {
    const engine: LlmMessage[] = [
      { role: "system", content: "engine default — ignore me" },
      { role: "user", content: "Senator, can we talk?" },
      { role: "assistant", content: "Who is this?" },
      { role: "user", content: "Someone who wants to understand." }
    ];
    const out = buildBatoMessages("BATO SYSTEM PROMPT", engine);
    expect(out[0]).toEqual({ role: "system", content: "BATO SYSTEM PROMPT" });
    expect(out.filter((m) => m.role === "system")).toHaveLength(1);
    expect(out.slice(1)).toEqual(engine.slice(1));
  });
});

describe("runStageJudge", () => {
  test("parses a passing verdict from the LLM", async () => {
    const provider = fakeProvider(
      '{"stage":{"current":1,"passed":true,"moved":"advanced","evidence":"first-person"},"catastrophic_event":null}'
    );
    const v = await runStageJudge(provider, 1, { negotiator: "n", bato: "b" });
    expect(v.passed).toBe(true);
    expect(v.moved).toBe("advanced");
  });

  test("falls back to a safe hold when the LLM returns garbage", async () => {
    const v = await runStageJudge(fakeProvider("sorry, I can't do that"), 2, {
      negotiator: "n",
      bato: "b"
    });
    expect(v.moved).toBe("held");
    expect(v.parseError).toBe(true);
    expect(v.current).toBe(2);
  });
});

describe("parseEmotion", () => {
  test("parses a valid emotion", () => {
    const e = parseEmotion({ primary: "fear", intensity: 0.7, valence: -0.4, shift: "softening" });
    expect(e).toEqual({ primary: "fear", intensity: 0.7, valence: -0.4, shift: "softening" });
  });

  test("clamps out-of-range intensity/valence and normalizes shift", () => {
    const e = parseEmotion({ primary: "anger", intensity: 5, valence: -9, shift: "nonsense" });
    expect(e.intensity).toBe(1);
    expect(e.valence).toBe(-1);
    expect(e.shift).toBe("steady");
  });

  test("falls back to neutral on garbage", () => {
    const e = parseEmotion("not json");
    expect(e.primary).toBe("unknown");
    expect(e.intensity).toBe(0);
    expect(e.shift).toBe("steady");
  });
});

describe("runEmotion", () => {
  test("returns the parsed emotion from the LLM", async () => {
    const provider = fakeProvider('{"primary":"exhaustion","intensity":0.6,"valence":-0.3,"shift":"steady"}');
    const e = await runEmotion(provider, { negotiator: "n", bato: "b" });
    expect(e.primary).toBe("exhaustion");
    expect(e.intensity).toBeCloseTo(0.6);
  });
});
