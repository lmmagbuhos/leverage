import AgoraRTC, {
  IAgoraRTCClient,
  ILocalAudioTrack,
  UID
} from "agora-rtc-sdk-ng";
import { computed, shallowRef } from "vue";

interface TokenResponse {
  appId: string;
  channelName: string;
  uid: UID;
  token: string;
  expiresIn: number;
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";

export function useAgora() {
  const client = shallowRef<IAgoraRTCClient | null>(null);
  const localAudioTrack = shallowRef<ILocalAudioTrack | null>(null);
  const connectionState = shallowRef<"idle" | "connecting" | "joined" | "error">(
    "idle"
  );
  const errorMessage = shallowRef<string | null>(null);

  const isJoined = computed(() => connectionState.value === "joined");
  const isConnecting = computed(() => connectionState.value === "connecting");

  async function joinChannel(channelName = "leverage-crisis-room") {
    connectionState.value = "connecting";
    errorMessage.value = null;

    try {
      const tokenUrl = new URL("/api/agora/token", API_BASE_URL);
      tokenUrl.searchParams.set("channelName", channelName);

      const tokenResponse = await fetch(tokenUrl);
      if (!tokenResponse.ok) {
        throw new Error(`Token request failed with ${tokenResponse.status}`);
      }

      const tokenData = (await tokenResponse.json()) as TokenResponse;
      const rtcClient = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });

      await rtcClient.join(
        tokenData.appId,
        tokenData.channelName,
        tokenData.token,
        tokenData.uid
      );

      const microphoneTrack = await AgoraRTC.createMicrophoneAudioTrack({
        encoderConfig: "speech_standard"
      });

      await rtcClient.publish([microphoneTrack]);

      client.value = rtcClient;
      localAudioTrack.value = microphoneTrack;
      connectionState.value = "joined";
    } catch (error) {
      connectionState.value = "error";
      errorMessage.value =
        error instanceof Error ? error.message : "Failed to join Agora channel.";
      throw error;
    }
  }

  async function leaveChannel() {
    localAudioTrack.value?.stop();
    localAudioTrack.value?.close();
    localAudioTrack.value = null;

    if (client.value) {
      await client.value.leave();
      client.value = null;
    }

    connectionState.value = "idle";
  }

  return {
    connectionState,
    errorMessage,
    isConnecting,
    isJoined,
    joinChannel,
    leaveChannel
  };
}
