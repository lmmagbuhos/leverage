import { describe, expect, test, vi } from "vitest";
import { LlmProvider } from "../llm/provider";
import { createEventBus, SessionEvent } from "../session/events";
import { createMemoryStore } from "../session/store";
import { runSideJobs } from "./turn";

// Routes provider.complete by which prompt is being run, so the real
// judge/emotion/coaching/press prompt-building + parsing are exercised.
function routingProvider(map: {
  judge: string;
  emotion: string;
  coaching: string;
  press: string;
}): LlmProvider {
  return {
    async complete(messages) {
      const text = messages.map((m) => m.content).join(" ");
      if (/neutral BCSM evaluator/.test(text)) return map.judge;
      if (/emotional state/.test(text)) return map.emotion;
      if (/negotiation coach/.test(text)) return map.coaching;
      if (/press desk/.test(text)) return map.press;
      return "";
    },
    async *streamChat() {
      yield "";
    }
  };
}

const EXCHANGE = { negotiator: "You've served thirty years. That matters.", bato: "I did what I was told." };

describe("runSideJobs", () => {
  test("advances the stage and emits stage/emotion/coaching/press events", async () => {
    const store = createMemoryStore();
    await store.create("s1");
    const bus = createEventBus();
    const events: SessionEvent[] = [];
    bus.subscribe("s1", (e) => events.push(e));

    const provider = routingProvider({
      judge: '{"stage":{"current":1,"passed":true,"moved":"advanced","evidence":"first-person"},"catastrophic_event":null}',
      emotion: '{"primary":"relief","intensity":0.5,"valence":0.2,"shift":"softening"}',
      coaching: '{"note":"Good acknowledgement.","technique":"active-listening"}',
      press: '{"headline":"Quiet talks","body":"Sources hint at contact."}'
    });

    await runSideJobs({ store, bus, provider }, "s1", EXCHANGE);

    const doc = await store.get("s1");
    expect(doc?.current_stage).toBe(2);
    expect(doc?.stage_passed[1]).toBe(true);
    expect(doc?.bato_emotion_ts).toHaveLength(1);
    expect(doc?.stage_ts).toHaveLength(1);

    const types = events.map((e) => e.type);
    expect(types).toContain("stage_update");
    expect(types).toContain("bato_emotion");
    expect(types).toContain("coaching");
    expect(types).toContain("press");
  });

  test("on a catastrophic event: ends the session, stops the agent, emits session_end", async () => {
    const store = createMemoryStore();
    await store.create("s1");
    const bus = createEventBus();
    const events: SessionEvent[] = [];
    bus.subscribe("s1", (e) => events.push(e));
    const stopAgent = vi.fn().mockResolvedValue(undefined);

    const provider = routingProvider({
      judge: '{"stage":{"current":1,"passed":false,"moved":"retreated","evidence":"leaked location"},"catastrophic_event":{"type":"location_reveal","evidence":"named the safe house"}}',
      emotion: '{"primary":"paranoia","intensity":0.9,"valence":-0.8,"shift":"rising"}',
      coaching: '{"note":"You revealed his location.","technique":"confidentiality"}',
      press: '{"headline":"x","body":"y"}'
    });

    await runSideJobs({ store, bus, provider, stopAgent }, "s1", EXCHANGE);

    const doc = await store.get("s1");
    expect(doc?.outcome).toBe("disengaged");
    expect(stopAgent).toHaveBeenCalledWith("s1");
    expect(events.map((e) => e.type)).toContain("session_end");
  });

  test("is a no-op for an unknown session", async () => {
    const store = createMemoryStore();
    const bus = createEventBus();
    const events: SessionEvent[] = [];
    bus.subscribe("nope", (e) => events.push(e));
    const provider = routingProvider({ judge: "", emotion: "", coaching: "", press: "" });

    await expect(runSideJobs({ store, bus, provider }, "nope", EXCHANGE)).resolves.toBeUndefined();
    expect(events).toHaveLength(0);
  });
});
