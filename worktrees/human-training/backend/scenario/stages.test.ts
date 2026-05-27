import { describe, expect, test } from "vitest";
import {
  STAGES,
  applyVerdict,
  parseStageVerdict,
  type StageState,
  type StageVerdict
} from "./stages";

describe("STAGES definitions", () => {
  test("defines all five BCSM stages with names, win signals, and catastrophic triggers", () => {
    expect(Object.keys(STAGES).sort()).toEqual(["1", "2", "3", "4", "5"]);
    expect(STAGES[1].name).toMatch(/active listening/i);
    expect(STAGES[5].name).toMatch(/behavioral change/i);
    for (const n of [1, 2, 3, 4, 5] as const) {
      expect(STAGES[n].number).toBe(n);
      expect(STAGES[n].winSignal.length).toBeGreaterThan(0);
      expect(STAGES[n].catastrophicTriggers.length).toBeGreaterThan(0);
    }
  });
});

describe("parseStageVerdict", () => {
  test("accepts a well-formed verdict", () => {
    const raw = {
      stage: { current: 2, passed: true, moved: "advanced", evidence: "first-person language" },
      catastrophic_event: null
    };
    const v = parseStageVerdict(raw, 2);
    expect(v.passed).toBe(true);
    expect(v.moved).toBe("advanced");
    expect(v.current).toBe(2);
    expect(v.catastrophicEvent).toBeNull();
    expect(v.parseError).toBeFalsy();
  });

  test("parses a catastrophic event", () => {
    const raw = {
      stage: { current: 1, passed: false, moved: "retreated", evidence: "leaked location" },
      catastrophic_event: { type: "location_reveal", evidence: "named his safe house" }
    };
    const v = parseStageVerdict(raw, 1);
    expect(v.moved).toBe("retreated");
    expect(v.catastrophicEvent?.type).toBe("location_reveal");
  });

  test("falls back to a safe stage-hold on malformed input (never throws)", () => {
    const v = parseStageVerdict("not json at all", 3);
    expect(v.current).toBe(3);
    expect(v.moved).toBe("held");
    expect(v.passed).toBe(false);
    expect(v.parseError).toBe(true);
  });

  test("rejects an out-of-range stage and falls back", () => {
    const v = parseStageVerdict({ stage: { current: 9, passed: true, moved: "advanced" } }, 1);
    expect(v.parseError).toBe(true);
    expect(v.current).toBe(1);
    expect(v.moved).toBe("held");
  });
});

describe("applyVerdict (stage gating)", () => {
  const fresh = (): StageState => ({
    current: 1,
    passed: { 1: false, 2: false, 3: false, 4: false, 5: false }
  });
  const verdict = (over: Partial<StageVerdict>): StageVerdict => ({
    current: 1,
    passed: false,
    moved: "held",
    evidence: "",
    catastrophicEvent: null,
    ...over
  });

  test("advances to the next stage and marks the prior stage passed", () => {
    const next = applyVerdict(fresh(), verdict({ current: 1, passed: true, moved: "advanced" }));
    expect(next.current).toBe(2);
    expect(next.passed[1]).toBe(true);
  });

  test("holds the stage when not passed", () => {
    const next = applyVerdict(fresh(), verdict({ current: 1, passed: false, moved: "held" }));
    expect(next.current).toBe(1);
    expect(next.passed[1]).toBe(false);
  });

  test("does not mutate the input state", () => {
    const state = fresh();
    applyVerdict(state, verdict({ current: 1, passed: true, moved: "advanced" }));
    expect(state.current).toBe(1);
    expect(state.passed[1]).toBe(false);
  });

  test("caps at stage 5 (passing stage 5 marks surrender, stays at 5)", () => {
    const atFive: StageState = {
      current: 5,
      passed: { 1: true, 2: true, 3: true, 4: true, 5: false }
    };
    const next = applyVerdict(atFive, verdict({ current: 5, passed: true, moved: "advanced" }));
    expect(next.current).toBe(5);
    expect(next.passed[5]).toBe(true);
  });
});
