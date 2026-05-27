import { describe, expect, test } from "vitest";
import { createMemoryStore } from "./store";
import { createEventBus, SessionEvent } from "./events";

describe("memory session store", () => {
  test("creates a session with sane defaults", async () => {
    const store = createMemoryStore();
    const doc = await store.create("s1", { scenario: "bato-dela-rosa", turn_mode: "open_mic" });
    expect(doc.session_id).toBe("s1");
    expect(doc.current_stage).toBe(1);
    expect(doc.stage_passed[1]).toBe(false);
    expect(doc.turn_mode).toBe("open_mic");
    expect(doc.outcome).toBeNull();
    expect(doc.transcript).toEqual([]);
  });

  test("get returns the stored doc and null for unknown ids", async () => {
    const store = createMemoryStore();
    await store.create("s1");
    expect((await store.get("s1"))?.session_id).toBe("s1");
    expect(await store.get("missing")).toBeNull();
  });

  test("put persists changes and keeps an updated_at timestamp", async () => {
    const store = createMemoryStore();
    const doc = await store.create("s1");
    doc.transcript.push({ speaker: "bato", text: "Who is this?", ts: "t" });
    doc.current_stage = 2;
    const saved = await store.put(doc);
    expect(typeof saved.updated_at).toBe("string");
    expect(saved.updated_at.length).toBeGreaterThan(0);
    const fetched = await store.get("s1");
    expect(fetched?.transcript).toHaveLength(1);
    expect(fetched?.current_stage).toBe(2);
  });
});

describe("event bus", () => {
  test("delivers events to subscribers of the same session only", () => {
    const bus = createEventBus();
    const a: SessionEvent[] = [];
    const b: SessionEvent[] = [];
    bus.subscribe("s1", (e) => a.push(e));
    bus.subscribe("s2", (e) => b.push(e));

    bus.publish("s1", { type: "stage_update", data: { stage: 2 } });

    expect(a).toHaveLength(1);
    expect(a[0].type).toBe("stage_update");
    expect(b).toHaveLength(0);
  });

  test("unsubscribe stops delivery", () => {
    const bus = createEventBus();
    const received: SessionEvent[] = [];
    const off = bus.subscribe("s1", (e) => received.push(e));
    bus.publish("s1", { type: "press", data: {} });
    off();
    bus.publish("s1", { type: "press", data: {} });
    expect(received).toHaveLength(1);
  });
});
