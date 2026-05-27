import OpenAI from "openai";

export interface AgentRuntimeConfig {
  sessionId: string;
  channelName: string;
}

export function createOpenAIClient(): OpenAI {
  const apiKey = process.env.MINIMAX_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("MINIMAX_API_KEY (or OPENAI_API_KEY) is required.");
  }

  const useMinimax = Boolean(process.env.MINIMAX_API_KEY);
  return new OpenAI({
    apiKey,
    ...(useMinimax ? { baseURL: "https://api.minimaxi.chat/v1" } : {}),
  });
}

export async function startNegotiationAgent(
  _config: AgentRuntimeConfig
): Promise<void> {
  /*
   * Agora's published npm package is `agora-agent-server-sdk`.
   * Its repository is `AgoraIO-Conversational-AI/agent-server-sdk-ts`.
   *
   * Wire the Agora conversational agent and OpenAI real-time logic here after
   * the hackathon prompt and turn-taking behavior are finalized.
   */
  throw new Error("Negotiation agent runtime is not implemented yet.");
}
