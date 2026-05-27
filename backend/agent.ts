import OpenAI from "openai";

export interface AgentRuntimeConfig {
  sessionId: string;
  channelName: string;
}

export function createOpenAIClient(): OpenAI {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required before starting the voice agent.");
  }

  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
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
