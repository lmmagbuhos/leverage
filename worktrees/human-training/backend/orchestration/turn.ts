import { runEmotion } from "../llm/emotion";
import { runCoaching, runPress } from "../llm/media";
import { runStageJudge } from "../llm/judge";
import { LlmProvider } from "../llm/provider";
import { applyVerdict, StageState } from "../scenario/stages";
import { EventBus } from "../session/events";
import { SessionStore } from "../session/store";

export interface TurnDeps {
  store: SessionStore;
  bus: EventBus;
  provider: LlmProvider;
  /** stop the Agora agent (called on a catastrophic event / surrender). */
  stopAgent?: (sessionId: string) => Promise<void>;
}

/**
 * Side jobs after Bato's streamed reply (Call B + emotion + media). Runs off the
 * reply critical path: judges the exchange, gates the stage, records signals, and
 * emits SSE events. Never throws into the caller.
 */
export async function runSideJobs(
  deps: TurnDeps,
  sessionId: string,
  exchange: { negotiator: string; bato: string }
): Promise<void> {
  const doc = await deps.store.get(sessionId);
  if (!doc) {
    return;
  }

  const ts = new Date().toISOString();
  const stage = doc.current_stage;

  // Independent calls run in parallel (reasoning models are slow; several per turn).
  const [verdict, emotion, press] = await Promise.all([
    runStageJudge(deps.provider, stage, exchange),
    runEmotion(deps.provider, exchange),
    runPress(deps.provider, {
      transcriptTail: `Negotiator: ${exchange.negotiator}\nBato: ${exchange.bato}`,
      stage
    })
  ]);

  const next = applyVerdict({ current: doc.current_stage, passed: doc.stage_passed }, verdict);
  doc.current_stage = next.current;
  doc.stage_passed = next.passed;
  doc.stage_ts.push({
    ts,
    stage: verdict.current,
    passed: verdict.passed,
    moved: verdict.moved,
    evidence: verdict.evidence
  });
  deps.bus.publish(sessionId, {
    type: "stage_update",
    data: {
      ts,
      stage: {
        current: next.current,
        passed: verdict.passed,
        moved: verdict.moved,
        evidence: verdict.evidence
      },
      catastrophic_event: verdict.catastrophicEvent
    }
  });

  // Bato's generated emotion (the study object).
  doc.bato_emotion_ts.push({ ts, ...emotion });
  deps.bus.publish(sessionId, { type: "bato_emotion", data: { ts, ...emotion } });

  // In-world press (live).
  doc.media_log.push({ ts, type: "press", content: press });
  deps.bus.publish(sessionId, { type: "press", data: { ts, ...press } });

  // Coaching (depends on emotion; ties the negotiator's move/delivery to Bato's reaction).
  const coaching = await runCoaching(deps.provider, {
    ...exchange,
    stage,
    emotion: emotion.primary
  });
  doc.media_log.push({ ts, type: "coaching", content: coaching });
  deps.bus.publish(sessionId, { type: "coaching", data: { ts, ...coaching } });

  const endSession = async (outcome: "disengaged" | "surrender", finalStage: number) => {
    doc.outcome = outcome;
    await deps.store.put(doc);
    if (deps.stopAgent) {
      try {
        await deps.stopAgent(sessionId);
      } catch {
        // best-effort; the session is already finalized
      }
    }
    deps.bus.publish(sessionId, {
      type: "session_end",
      data: { ts, outcome, final_stage_reached: finalStage }
    });
  };

  if (verdict.catastrophicEvent) {
    await endSession("disengaged", stage);
    return;
  }
  if (stage === 5 && verdict.passed) {
    await endSession("surrender", 5);
    return;
  }

  await deps.store.put(doc);
}

export type { StageState };

