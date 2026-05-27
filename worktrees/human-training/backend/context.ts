import { createOpenAIProvider, LlmProvider } from "./llm/provider";
import { loadScenarioContent, ScenarioContent } from "./scenario/content";
import { createEventBus, EventBus } from "./session/events";
import { createSessionStore, SessionStore } from "./session/store";

export interface AppContext {
  store: SessionStore;
  bus: EventBus;
  provider: LlmProvider;
  content: ScenarioContent;
  appId: string;
  appCertificate: string;
  tokenExpire: number;
  /** Public base URL the Agora engine calls back for the custom LLM. */
  llmBaseUrl: string;
}

export function createContext(): AppContext {
  return {
    store: createSessionStore(),
    bus: createEventBus(),
    provider: createOpenAIProvider(),
    content: loadScenarioContent(),
    appId: process.env.AGORA_APP_ID ?? "",
    appCertificate: process.env.AGORA_APP_CERTIFICATE ?? "",
    tokenExpire: Number(process.env.AGORA_TOKEN_EXPIRE_SECONDS || 3600),
    llmBaseUrl: process.env.LLM_BASE_URL ?? `http://localhost:${process.env.PORT || 4000}`
  };
}
