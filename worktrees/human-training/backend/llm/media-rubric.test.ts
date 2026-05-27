import { describe, expect, test } from "vitest";
import { parseCoaching, parsePress } from "./media";
import { parseRubric } from "./rubric";

describe("parsePress", () => {
  test("parses a structured press item", () => {
    const p = parsePress({ headline: "Senate erupts", body: "Allies rally as warrant looms." });
    expect(p).toEqual({ headline: "Senate erupts", body: "Allies rally as warrant looms." });
  });

  test("treats a bare string as the body", () => {
    const p = parsePress("Reports swirl about a possible surrender.");
    expect(p.body).toContain("surrender");
    expect(typeof p.headline).toBe("string");
  });
});

describe("parseCoaching", () => {
  test("parses a structured coaching item", () => {
    const c = parseCoaching({ note: "You rushed to influence.", technique: "empathy" });
    expect(c.note).toMatch(/rushed/);
    expect(c.technique).toBe("empathy");
  });

  test("treats a bare string as the note", () => {
    const c = parseCoaching("Good mirroring — Bato softened.");
    expect(c.note).toContain("mirroring");
    expect(typeof c.technique).toBe("string");
  });
});

describe("parseRubric", () => {
  test("parses per-stage scores and clamps the total to 0..15", () => {
    const r = parseRubric({
      per_stage: [
        { stage: 1, score: 2, positives: ["paraphrasing"], negatives: [] },
        { stage: 2, score: 5, positives: [], negatives: ["pivoted early"] }
      ],
      total_15: 99
    });
    expect(r.perStage).toHaveLength(2);
    expect(r.perStage[1].score).toBe(3); // clamped from 5
    expect(r.total15).toBe(15); // clamped from 99
  });

  test("falls back to an empty rubric on garbage", () => {
    const r = parseRubric("nope");
    expect(r.perStage).toEqual([]);
    expect(r.total15).toBe(0);
  });
});
