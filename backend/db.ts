import * as couchbase from "couchbase";
import type { Collection } from "couchbase";
import path from "path";
import fs from "fs";

export type GameStage = 1 | 2 | 3;

export interface GameState {
  session_id: string;
  stress_level: number;
  current_stage: GameStage;
  updated_at: string;
}

export interface GameStatePatch {
  stress_level?: number;
  stress_delta?: number;
  current_stage?: GameStage;
}

export interface CanonicalRun {
  personaId: string;
  turns: object[];        // TurnResponse[] — for instant replay
  history: object[];      // TurnRecord[] — full transcript (agent+bato per turn)
  stageResults: object[]; // StageResult[] — per-stage metadata
  evaluation: object;     // EvaluationResult — final BCSM scores
  savedAt: string;
}

const memoryStore = new Map<string, GameState>();
const canonicalMemoryStore = new Map<string, CanonicalRun>();

let collectionPromise: Promise<Collection | null> | null = null;

function hasCouchbaseConfig(): boolean {
  return Boolean(
    process.env.COUCHBASE_CONNECTION_STRING &&
      process.env.COUCHBASE_USERNAME &&
      process.env.COUCHBASE_PASSWORD &&
      process.env.COUCHBASE_BUCKET
  );
}

function createDefaultState(sessionId: string): GameState {
  return {
    session_id: sessionId,
    stress_level: 80,
    current_stage: 1,
    updated_at: new Date().toISOString()
  };
}

function clampStressLevel(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function deriveStage(stressLevel: number): GameStage {
  if (stressLevel <= 30) return 3;
  if (stressLevel <= 60) return 2;
  return 1;
}

async function getCollection(): Promise<Collection | null> {
  if (!hasCouchbaseConfig()) return null;
  if (!collectionPromise) {
    collectionPromise = Promise.resolve().then(async () => {
      try {
        const cluster = await couchbase.connect(process.env.COUCHBASE_CONNECTION_STRING as string, {
          username: process.env.COUCHBASE_USERNAME as string,
          password: process.env.COUCHBASE_PASSWORD as string,
          configProfile: "wanDevelopment"
        });
        const bucket = cluster.bucket(process.env.COUCHBASE_BUCKET as string);
        const scope = bucket.scope(process.env.COUCHBASE_SCOPE || "_default");
        return scope.collection(process.env.COUCHBASE_COLLECTION || "_default");
      } catch (err) {
        console.warn("Couchbase connection failed, using in-memory store:", (err as Error).message);
        collectionPromise = null;
        return null;
      }
    });
  }
  return collectionPromise;
}

export async function initDb(): Promise<void> {
  const collection = await getCollection();
  console.log(`Couchbase: ${collection ? "connected" : "using in-memory fallback"}`);
}

export async function getGameState(sessionId: string): Promise<GameState> {
  const collection = await getCollection();
  if (!collection) {
    const existing = memoryStore.get(sessionId);
    if (existing) return existing;
    const defaultState = createDefaultState(sessionId);
    memoryStore.set(sessionId, defaultState);
    return defaultState;
  }
  try {
    const result = await collection.get(sessionId);
    return result.content as GameState;
  } catch (error) {
    if (error instanceof couchbase.DocumentNotFoundError) {
      const defaultState = createDefaultState(sessionId);
      await collection.upsert(sessionId, defaultState);
      return defaultState;
    }
    throw error;
  }
}

export async function updateGameState(
  sessionId: string,
  patch: GameStatePatch
): Promise<GameState> {
  const existing = await getGameState(sessionId);
  const nextStressLevel = clampStressLevel(
    typeof patch.stress_level === "number"
      ? patch.stress_level
      : existing.stress_level + (patch.stress_delta ?? 0)
  );
  const nextState: GameState = {
    ...existing,
    stress_level: nextStressLevel,
    current_stage: patch.current_stage ?? deriveStage(nextStressLevel),
    updated_at: new Date().toISOString()
  };
  const collection = await getCollection();
  if (!collection) {
    memoryStore.set(sessionId, nextState);
    return nextState;
  }
  await collection.upsert(sessionId, nextState);
  return nextState;
}

const PERSONA_HISTORY_DIR = path.resolve(__dirname, "..", "persona-history");

function personaDir(personaId: string): string {
  return path.join(PERSONA_HISTORY_DIR, personaId);
}

export async function saveCanonicalRun(personaId: string, data: CanonicalRun): Promise<void> {
  const dir = personaDir(personaId);
  fs.mkdirSync(dir, { recursive: true });

  // session.json — full data for replay
  fs.writeFileSync(
    path.join(dir, "session.json"),
    JSON.stringify(data, null, 2),
    "utf-8"
  );

  // benchmark.json — evaluation scores only
  fs.writeFileSync(
    path.join(dir, "benchmark.json"),
    JSON.stringify(data.evaluation, null, 2),
    "utf-8"
  );

  // transcript.md — human-readable conversation
  const lines: string[] = [
    `# ${personaId} — BCSM Negotiation Transcript`,
    `Saved: ${data.savedAt}`,
    "",
  ];
  for (const turn of data.turns as Array<Record<string, unknown>>) {
    lines.push(`## Stage ${turn.newStage} — ${String(turn.result).toUpperCase()}`);
    lines.push(`**Agent:** ${turn.agentMove}`);
    lines.push(`**Bato** *(${turn.emotion})*: ${turn.batoReply}`);
    lines.push(`*${turn.reason}*`);
    lines.push("");
  }
  const ev = data.evaluation as Record<string, unknown>;
  lines.push(`---`);
  lines.push(`## Benchmark: ${ev.totalScore}/15`);
  lines.push(String(ev.overallAssessment));
  fs.writeFileSync(path.join(dir, "transcript.md"), lines.join("\n"), "utf-8");

  canonicalMemoryStore.set(personaId, data);
  console.log(`Saved persona run: persona-history/${personaId}/`);
}

export async function getCanonicalRun(personaId: string): Promise<CanonicalRun | null> {
  // Memory cache hit
  const cached = canonicalMemoryStore.get(personaId);
  if (cached) return cached;

  // Load from disk
  const file = path.join(personaDir(personaId), "session.json");
  if (!fs.existsSync(file)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf-8")) as CanonicalRun;
    canonicalMemoryStore.set(personaId, data);
    console.log(`Loaded persona run from disk: persona-history/${personaId}/`);
    return data;
  } catch (err) {
    console.warn(`Failed to load persona run for ${personaId}:`, (err as Error).message);
    return null;
  }
}
