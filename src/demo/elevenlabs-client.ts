import { ExternalServiceError } from "@/src/server/errors";
import { ELEVENLABS_CONFIG } from "./config";
import { fetchExternal } from "./fetch-external";

const { baseUrl, modelId, outputFormat } = ELEVENLABS_CONFIG;

/** TTS can be slow for long text. */
const FETCH_TIMEOUT_MS = 30_000;

/**
 * Convert text to speech using the ElevenLabs API.
 * Returns the response body as a ReadableStream (MP3 format) for streaming to the client.
 */
export async function textToSpeech(
  text: string,
  voiceId?: string
): Promise<{ body: ReadableStream<Uint8Array>; contentLength: string | null }> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new ExternalServiceError(
      "ELEVENLABS_API_KEY is not configured",
      "elevenlabs"
    );
  }

  const resolvedVoiceId = voiceId ?? process.env.ELEVENLABS_VOICE_ID;
  if (!resolvedVoiceId) {
    throw new ExternalServiceError(
      "No voice ID provided and ELEVENLABS_VOICE_ID is not configured",
      "elevenlabs"
    );
  }

  const res = await fetchExternal(
    `${baseUrl}/text-to-speech/${encodeURIComponent(resolvedVoiceId)}?output_format=${outputFormat}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        model_id: modelId,
      }),
    },
    "elevenlabs",
    FETCH_TIMEOUT_MS
  );

  if (!res.body) {
    throw new ExternalServiceError(
      "ElevenLabs returned no response body",
      "elevenlabs"
    );
  }

  return {
    body: res.body,
    contentLength: res.headers.get("content-length"),
  };
}
