import { describe, expect, test } from "vitest";
import {
  buildBatoSystemPrompt,
  buildStageJudgePrompt,
  loadScenarioContent
} from "./content";

describe("loadScenarioContent", () => {
  const content = loadScenarioContent();

  test("loads Bato's identity from the character files", () => {
    expect(content.identity).toMatch(/dela Rosa/i);
    expect(content.identity.length).toBeGreaterThan(500);
  });

  test("loads base + agenda for all five stages", () => {
    for (const n of [1, 2, 3, 4, 5] as const) {
      expect(content.stages[n].base.length).toBeGreaterThan(0);
      expect(content.stages[n].agenda.length).toBeGreaterThan(0);
    }
  });
});

describe("buildBatoSystemPrompt", () => {
  const content = loadScenarioContent();

  test("includes identity, the stage agenda, and the in-character guardrail", () => {
    const prompt = buildBatoSystemPrompt(1, content);
    expect(prompt).toMatch(/dela Rosa/i);
    expect(prompt).toContain(content.stages[1].agenda);
    // global guardrails Bato must always honor
    expect(prompt).toMatch(/in character/i);
    expect(prompt).toMatch(/Duterte/i); // loyalty rule referenced
  });

  test("swaps the agenda when the stage changes", () => {
    const p1 = buildBatoSystemPrompt(1, content);
    const p3 = buildBatoSystemPrompt(3, content);
    expect(p1).toContain(content.stages[1].agenda);
    expect(p3).toContain(content.stages[3].agenda);
    expect(p1).not.toBe(p3);
  });
});

describe("buildStageJudgePrompt", () => {
  test("includes the stage's win signal, the exchange, and asks for JSON", () => {
    const prompt = buildStageJudgePrompt(2, {
      negotiator: "It sounds like you're scared.",
      bato: "Yes. I am. I have not slept in weeks."
    });
    expect(prompt).toMatch(/Empathy/i);
    expect(prompt).toContain("It sounds like you're scared.");
    expect(prompt).toContain("I have not slept in weeks.");
    expect(prompt).toMatch(/json/i);
    expect(prompt).toMatch(/passed/i);
    expect(prompt).toMatch(/catastrophic/i);
  });
});
