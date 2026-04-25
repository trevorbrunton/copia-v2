/**
 * Speech-to-text via ElevenLabs `scribe_v1`.
 *
 * Lifted from v1's `app/api/v1/demo/process/route.ts` STT helper so
 * the v2 process route can transcribe in the same step as intent
 * classification.
 */
import { ExternalServiceError } from "@/src/server/errors";
import { logger } from "@/src/lib/logger";

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY ?? "";

/**
 * Wrap raw PCM Int16 LE samples in a minimal WAV header so the STT
 * service identifies the format correctly.
 */
function pcmToWav(pcm: ArrayBuffer, sampleRate: number): ArrayBuffer {
  const pcmBytes = new Uint8Array(pcm);
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = pcmBytes.length;
  const headerSize = 44;

  const wav = new ArrayBuffer(headerSize + dataSize);
  const view = new DataView(wav);
  const bytes = new Uint8Array(wav);

  bytes.set([0x52, 0x49, 0x46, 0x46], 0); // "RIFF"
  view.setUint32(4, 36 + dataSize, true);
  bytes.set([0x57, 0x41, 0x56, 0x45], 8); // "WAVE"
  bytes.set([0x66, 0x6d, 0x74, 0x20], 12); // "fmt "
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  bytes.set([0x64, 0x61, 0x74, 0x61], 36); // "data"
  view.setUint32(40, dataSize, true);
  bytes.set(pcmBytes, headerSize);

  return wav;
}

/**
 * Transcribe PCM audio via ElevenLabs STT. Returns the transcribed
 * text trimmed; empty string when no speech detected.
 */
export async function transcribePcm(args: {
  pcm: ArrayBuffer;
  sampleRate: number;
  traceId: string;
}): Promise<string> {
  if (!ELEVENLABS_API_KEY) {
    throw new ExternalServiceError("ELEVENLABS_API_KEY is not configured", "elevenlabs");
  }

  const wav = pcmToWav(args.pcm, args.sampleRate);

  const body = new FormData();
  body.append("file", new Blob([wav], { type: "audio/wav" }), "audio.wav");
  body.append("model_id", "scribe_v1");
  body.append("language_code", "eng");

  const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: { "xi-api-key": ELEVENLABS_API_KEY },
    body,
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const errBody = await res.text();
    logger.error(
      { traceId: args.traceId, status: res.status, body: errBody },
      "screen:stt failed"
    );
    throw new ExternalServiceError(
      `ElevenLabs STT error: ${res.status} ${errBody}`,
      "elevenlabs"
    );
  }

  const result = (await res.json()) as { text?: string };
  return (result.text ?? "").trim();
}
