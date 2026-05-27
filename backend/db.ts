import couchbase, { Collection } from "couchbase";

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

const memoryStore = new Map<string, GameState>();

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
  if (stressLevel <= 30) {
    return 3;
  }

  if (stressLevel <= 60) {
    return 2;
  }

  return 1;
}

async function getCollection(): Promise<Collection | null> {
  if (!hasCouchbaseConfig()) {
    return null;
  }

  if (!collectionPromise) {
    collectionPromise = couchbase
      .connect(process.env.COUCHBASE_CONNECTION_STRING as string, {
        username: process.env.COUCHBASE_USERNAME as string,
        password: process.env.COUCHBASE_PASSWORD as string,
        configProfile: "wanDevelopment"
      })
      .then((cluster) => {
        const bucket = cluster.bucket(process.env.COUCHBASE_BUCKET as string);
        const scope = bucket.scope(process.env.COUCHBASE_SCOPE || "_default");
        return scope.collection(process.env.COUCHBASE_COLLECTION || "_default");
      });
  }

  return collectionPromise;
}

export async function getGameState(sessionId: string): Promise<GameState> {
  const collection = await getCollection();

  if (!collection) {
    const existing = memoryStore.get(sessionId);
    if (existing) {
      return existing;
    }

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
