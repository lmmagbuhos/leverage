import { describe, expect, test } from "vitest";
import { looseJsonParse, stripThink } from "./json";

describe("stripThink", () => {
  test("removes a closed think block", () => {
    expect(stripThink("<think>reasoning here</think>\n\nFinally, someone listens.")).toBe(
      "Finally, someone listens."
    );
  });
  test("drops an unclosed (truncated) think block", () => {
    expect(stripThink("<think>reasoning that never closed")).toBe("");
  });
  test("leaves plain text untouched", () => {
    expect(stripThink("Who sent you?")).toBe("Who sent you?");
  });
});

describe("looseJsonParse", () => {
  test("parses plain JSON", () => {
    expect(looseJsonParse('{"a":1}')).toEqual({ a: 1 });
  });
  test("parses JSON after a think block", () => {
    expect(looseJsonParse('<think>deciding</think>\n{"passed":true}')).toEqual({ passed: true });
  });
  test("parses JSON inside markdown fences", () => {
    expect(looseJsonParse('```json\n{"x":2}\n```')).toEqual({ x: 2 });
  });
  test("extracts JSON embedded in prose", () => {
    expect(looseJsonParse('Sure! {"y":3} hope that helps')).toEqual({ y: 3 });
  });
  test("returns undefined when there is no JSON", () => {
    expect(looseJsonParse("no json here")).toBeUndefined();
  });
});
