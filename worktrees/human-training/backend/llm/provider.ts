import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { stripThink } from "../util/json";

// Provider-agnostic LLM port. OpenAI is the active backend; swapping providers
// means implementing this interface, not touching callers.
export type LlmRole = "system" | "user" | "assistant";
export interface LlmMessage {
  role: LlmRole;
  content: string;
}

export interface LlmCompleteOpts {
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface LlmProvider {
  /** Non-streaming completion — used by the Stage Judge, emotion, media, rubric. */
  complete(messages: LlmMessage[], opts?: LlmCompleteOpts): Promise<string>;
  /** Streaming completion — used by Bato (Call A) so the engine can TTS as tokens arrive. */
  streamChat(messages: LlmMessage[], opts?: LlmCompleteOpts): AsyncIterable<string>;
}

export function createOpenAIProvider(
  client: OpenAI = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    // baseURL lets any OpenAI-compatible provider (e.g. MiniMax) back this port.
    baseURL: process.env.OPENAI_BASE_URL || undefined
  })
): LlmProvider {
  const defaultModel = process.env.OPENAI_MODEL || "gpt-4o";
  return {
    async complete(messages, opts) {
      const res = await client.chat.completions.create({
        model: opts?.model || defaultModel,
        temperature: opts?.temperature ?? 0.2,
        max_tokens: opts?.maxTokens,
        messages: messages as ChatCompletionMessageParam[]
      });
      // Reasoning models (e.g. MiniMax M2) emit <think> blocks inline — strip them.
      return stripThink(res.choices[0]?.message?.content ?? "");
    },
    async *streamChat(messages, opts) {
      const stream = await client.chat.completions.create({
        model: opts?.model || defaultModel,
        temperature: opts?.temperature ?? 0.8,
        stream: true,
        messages: messages as ChatCompletionMessageParam[]
      });
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) yield delta;
      }
    }
  };
}
