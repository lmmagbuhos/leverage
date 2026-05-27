import { StageNumber } from "../scenario/stages";

export type Outcome = "surrender" | "partial" | "disengaged" | "failed" | null;
export type TurnMode = "push_to_talk" | "open_mic";

export interface TranscriptTurn {
  speaker: "negotiator" | "bato";
  text: string;
  ts: string;
}

export interface SessionDoc {
  session_id: string;
  mode: "human-training";
  scenario: string;
  agent_id: string | null;
  channel: string | null;
  turn_mode: TurnMode;
  current_stage: StageNumber;
  stage_passed: Record<StageNumber, boolean>;
  outcome: Outcome;
  transcript: TranscriptTurn[];
  negotiator_prosody_ts: unknown[];
  bato_emotion_ts: unknown[];
  stage_ts: unknown[];
  media_log: unknown[];
  rubric: { perStage: unknown[]; total15: number | null };
  updated_at: string;
}

export interface SessionInit {
  scenario?: string;
  turn_mode?: TurnMode;
  channel?: string;
  agent_id?: string;
}

export interface SessionStore {
  create(sessionId: string, init?: SessionInit): Promise<SessionDoc>;
  get(sessionId: string): Promise<SessionDoc | null>;
  put(doc: SessionDoc): Promise<SessionDoc>;
}

export function defaultSession(sessionId: string, init: SessionInit = {}): SessionDoc {
  return {
    session_id: sessionId,
    mode: "human-training",
    scenario: init.scenario ?? "bato-dela-rosa",
    agent_id: init.agent_id ?? null,
    channel: init.channel ?? null,
    turn_mode: init.turn_mode ?? "push_to_talk",
    current_stage: 1,
    stage_passed: { 1: false, 2: false, 3: false, 4: false, 5: false },
    outcome: null,
    transcript: [],
    negotiator_prosody_ts: [],
    bato_emotion_ts: [],
    stage_ts: [],
    media_log: [],
    rubric: { perStage: [], total15: null },
    updated_at: new Date().toISOString()
  };
}

export function createMemoryStore(): SessionStore {
  const map = new Map<string, SessionDoc>();
  return {
    async create(sessionId, init) {
      const doc = defaultSession(sessionId, init);
      map.set(sessionId, structuredClone(doc));
      return doc;
    },
    async get(sessionId) {
      const doc = map.get(sessionId);
      return doc ? structuredClone(doc) : null;
    },
    async put(doc) {
      const next = { ...doc, updated_at: new Date().toISOString() };
      map.set(doc.session_id, structuredClone(next));
      return next;
    }
  };
}

function hasCouchbaseConfig(): boolean {
  return Boolean(
    process.env.COUCHBASE_CONNECTION_STRING &&
      process.env.COUCHBASE_USERNAME &&
      process.env.COUCHBASE_PASSWORD &&
      process.env.COUCHBASE_BUCKET
  );
}

function createCouchbaseStore(): SessionStore {
  // couchbase is imported lazily so the app/tests never require it unless configured.
  let collectionPromise: Promise<import("couchbase").Collection> | null = null;
  async function collection() {
    if (!collectionPromise) {
      collectionPromise = (async () => {
        const couchbase = await import("couchbase");
        const cluster = await couchbase.connect(
          process.env.COUCHBASE_CONNECTION_STRING as string,
          {
            username: process.env.COUCHBASE_USERNAME as string,
            password: process.env.COUCHBASE_PASSWORD as string,
            configProfile: "wanDevelopment"
          }
        );
        const bucket = cluster.bucket(process.env.COUCHBASE_BUCKET as string);
        const scope = bucket.scope(process.env.COUCHBASE_SCOPE || "_default");
        return scope.collection(process.env.COUCHBASE_COLLECTION || "_default");
      })();
    }
    return collectionPromise;
  }

  return {
    async create(sessionId, init) {
      const doc = defaultSession(sessionId, init);
      await (await collection()).upsert(sessionId, doc);
      return doc;
    },
    async get(sessionId) {
      try {
        const result = await (await collection()).get(sessionId);
        return result.content as SessionDoc;
      } catch (error) {
        const couchbase = await import("couchbase");
        if (error instanceof couchbase.DocumentNotFoundError) {
          return null;
        }
        throw error;
      }
    },
    async put(doc) {
      const next = { ...doc, updated_at: new Date().toISOString() };
      await (await collection()).upsert(doc.session_id, next);
      return next;
    }
  };
}

/**
 * In-memory by default. Couchbase only when explicitly opted in (SESSION_STORE=couchbase)
 * AND configured — so stray placeholder creds never trigger a real (timing-out) connection.
 */
export function createSessionStore(): SessionStore {
  if (process.env.SESSION_STORE === "couchbase" && hasCouchbaseConfig()) {
    return createCouchbaseStore();
  }
  return createMemoryStore();
}
