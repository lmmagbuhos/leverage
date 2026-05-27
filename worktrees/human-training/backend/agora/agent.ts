// Agora Conversational AI Engine agent control (join/leave) + the join-body builder.
// The join body is built purely (testable); the HTTP calls are thin glue.

export interface JoinConfig {
  channel: string;
  agentRtcToken: string;
  agentUid?: string;
  llmBaseUrl: string; // public base URL Agora calls back, e.g. https://host
  sessionId: string;
  remoteUids?: string[]; // RTC uids the agent listens to (default: all)
  model?: string;
  ttsVendor?: string;
  ttsVoice?: string;
  ttsKey?: string;
  ttsRegion?: string;
  ttsParams?: Record<string, unknown>;
  greeting?: string;
  asrLanguage?: string;
}

export interface JoinBody {
  name: string;
  properties: Record<string, unknown>;
}

const AGORA_BASE = "https://api.agora.io/api/conversational-ai-agent/v2/projects";

/**
 * Build the Conversational AI Engine `join` body. The custom-LLM URL embeds the
 * session id in its PATH — that is how our /chat/completions handler knows which
 * session a request belongs to (Agora has no custom-header mechanism).
 */
export function buildJoinBody(cfg: JoinConfig): JoinBody {
  const properties: Record<string, unknown> = {
    channel: cfg.channel,
    token: cfg.agentRtcToken,
    agent_rtc_uid: cfg.agentUid ?? "0",
    remote_rtc_uids: cfg.remoteUids ?? ["*"],
    enable_string_uid: false,
    llm: {
      url: `${cfg.llmBaseUrl}/api/llm/${cfg.sessionId}/chat/completions`,
      system_messages: [
        { role: "system", content: "Per-stage Bato prompt is injected by the endpoint." }
      ],
      greeting_message: cfg.greeting ?? "",
      max_history: 20,
      params: { model: cfg.model ?? "gpt-4o" }
    },
    asr: { language: cfg.asrLanguage ?? "en-US" }
  };
  // Only include TTS when a key is configured; params shape differs per vendor.
  if (cfg.ttsKey) {
    const vendor = cfg.ttsVendor ?? "microsoft";
    if (vendor === "elevenlabs") {
      properties.tts = {
        vendor: "elevenlabs",
        params: {
          base_url: "wss://api.elevenlabs.io/v1",
          key: cfg.ttsKey,
          model_id: "eleven_flash_v2_5",
          voice_id: cfg.ttsVoice ?? "pNInz6obpgDQGcFmaJgB",
          sample_rate: 24000,
          ...(cfg.ttsParams ?? {})
        }
      };
    } else {
      properties.tts = {
        vendor,
        params: {
          key: cfg.ttsKey,
          region: cfg.ttsRegion,
          voice_name: cfg.ttsVoice ?? "en-US-AndrewMultilingualNeural",
          ...(cfg.ttsParams ?? {})
        }
      };
    }
  }
  return { name: cfg.sessionId, properties };
}

function authHeader(): string {
  const id = process.env.AGORA_CUSTOMER_ID ?? "";
  const secret = process.env.AGORA_CUSTOMER_SECRET ?? "";
  return "Basic " + Buffer.from(`${id}:${secret}`).toString("base64");
}

export async function startAgent(appId: string, cfg: JoinConfig): Promise<{ agentId: string }> {
  const res = await fetch(`${AGORA_BASE}/${appId}/join`, {
    method: "POST",
    headers: { Authorization: authHeader(), "Content-Type": "application/json" },
    body: JSON.stringify(buildJoinBody(cfg)),
    signal: AbortSignal.timeout(20000)
  });
  if (!res.ok) {
    throw new Error(`Agora join failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { agent_id?: string };
  if (!data.agent_id) {
    throw new Error("Agora join returned no agent_id");
  }
  return { agentId: data.agent_id };
}

export async function stopAgent(appId: string, agentId: string): Promise<void> {
  const res = await fetch(`${AGORA_BASE}/${appId}/agents/${agentId}/leave`, {
    method: "POST",
    headers: { Authorization: authHeader() }
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`Agora leave failed: ${res.status} ${await res.text()}`);
  }
}
