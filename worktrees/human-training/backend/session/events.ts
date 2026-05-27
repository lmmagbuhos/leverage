// In-process pub/sub bridging async LLM side-jobs (Stage Judge, emotion, media, rubric)
// to a session's SSE stream. Single-process; swap for Redis pub/sub if scaled out.

export interface SessionEvent {
  type: string;
  data: unknown;
}

export type EventHandler = (event: SessionEvent) => void;

export interface EventBus {
  publish(sessionId: string, event: SessionEvent): void;
  /** Returns an unsubscribe function. */
  subscribe(sessionId: string, handler: EventHandler): () => void;
}

export function createEventBus(): EventBus {
  const subscribers = new Map<string, Set<EventHandler>>();
  return {
    publish(sessionId, event) {
      subscribers.get(sessionId)?.forEach((handler) => handler(event));
    },
    subscribe(sessionId, handler) {
      let set = subscribers.get(sessionId);
      if (!set) {
        set = new Set();
        subscribers.set(sessionId, set);
      }
      set.add(handler);
      return () => {
        set.delete(handler);
        if (set.size === 0) {
          subscribers.delete(sessionId);
        }
      };
    }
  };
}
