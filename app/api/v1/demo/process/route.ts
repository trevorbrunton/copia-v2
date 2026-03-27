import { handleAppError } from "@/src/server/errors";
import { ExternalServiceError } from "@/src/server/errors";
import { matchQuestion } from "@/src/demo/bedrock-matcher";
import { processAudioWithGemini } from "@/src/demo/gemini-matcher";
import { logger } from "@/src/lib/logger";

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY ?? "";
const PROCESSING_MODE = process.env.NEXT_PUBLIC_PROCESSING_MODE ?? "default";

/**
 * Wrap raw PCM Int16 LE samples in a minimal WAV header
 * so ElevenLabs STT / Gemini can identify the format.
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

  // RIFF header
  bytes.set([0x52, 0x49, 0x46, 0x46], 0); // "RIFF"
  view.setUint32(4, 36 + dataSize, true);
  bytes.set([0x57, 0x41, 0x56, 0x45], 8); // "WAVE"

  // fmt sub-chunk
  bytes.set([0x66, 0x6d, 0x74, 0x20], 12); // "fmt "
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // data sub-chunk
  bytes.set([0x64, 0x61, 0x74, 0x61], 36); // "data"
  view.setUint32(40, dataSize, true);
  bytes.set(pcmBytes, headerSize);

  return wav;
}

/**
 * Convert an ArrayBuffer to a base64 string.
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Transcribe PCM audio via ElevenLabs STT (default pipeline).
 */
async function transcribeWithElevenLabs(
  pcmBuffer: ArrayBuffer,
  sampleRate: number,
  traceId: string
): Promise<string> {
  const wav = pcmToWav(pcmBuffer, sampleRate);

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
      { traceId, status: res.status, body: errBody },
      "demo:process STT failed"
    );
    throw new ExternalServiceError(
      `ElevenLabs STT error: ${res.status} ${errBody}`,
      "elevenlabs"
    );
  }

  const result = await res.json();
  return (result.text ?? "").trim();
}

/**
 * POST /api/v1/demo/process
 *
 * Single endpoint that transcribes PCM audio and matches the question
 * to a pre-produced demo response.
 *
 * Processing pipeline is selected by NEXT_PUBLIC_PROCESSING_MODE:
 *   - "flash":   Gemini 2.5 Flash (single call: audio → transcript + category)
 *   - "default": ElevenLabs STT → Bedrock Haiku classifier (two-step)
 *
 * Expects multipart/form-data with:
 *   - audio: binary PCM blob
 *   - sampleRate: number (e.g. 48000)
 *
 * Returns { text: string, category: string, answerText: string, audioUrl: string, pcmUrl: string, videoUrl: string }
 *         or { text: "" } if no speech detected.
 *
 * Intentionally unauthenticated — powers the public investor demo page.
 */
export async function POST(req: Request) {
  const traceId = crypto.randomUUID();
  try {
    const formData = await req.formData();
    const audioFile = formData.get("audio");
    const sampleRateStr = formData.get("sampleRate");

    if (!audioFile || !(audioFile instanceof Blob)) {
      return Response.json(
        {
          error: {
            code: "INVALID_INPUT",
            message: "audio file is required",
          },
        },
        { status: 400 }
      );
    }

    const sampleRate = parseInt(String(sampleRateStr || "48000"), 10);
    const pcmBuffer = await audioFile.arrayBuffer();

    const MAX_AUDIO_BYTES = 10_000_000;
    if (pcmBuffer.byteLength > MAX_AUDIO_BYTES) {
      return Response.json(
        {
          error: {
            code: "INVALID_INPUT",
            message: `audio exceeds maximum size of ${MAX_AUDIO_BYTES} bytes`,
          },
        },
        { status: 400 }
      );
    }

    logger.info(
      { traceId, audioBytes: pcmBuffer.byteLength, sampleRate, pipeline: PROCESSING_MODE },
      "demo:process request"
    );

    // ─── Gemini Flash pipeline: single call for STT + classification ───
    if (PROCESSING_MODE === "flash") {
      const wav = pcmToWav(pcmBuffer, sampleRate);
      const wavBase64 = arrayBufferToBase64(wav);

      const { text, match } = await processAudioWithGemini(wavBase64, traceId);

      if (!text || !match) {
        logger.info({ traceId }, "demo:process (flash) no speech detected");
        return Response.json({ text: "" });
      }

      logger.info(
        { traceId, textLength: text.length, category: match.category },
        "demo:process (flash) complete"
      );

      return Response.json({ text, ...match });
    }

    // ─── Default pipeline: ElevenLabs STT → Bedrock Haiku ─────────────
    if (!ELEVENLABS_API_KEY) {
      throw new ExternalServiceError(
        "ELEVENLABS_API_KEY is not configured",
        "elevenlabs"
      );
    }

    // Step 1: Transcribe
    const userText = await transcribeWithElevenLabs(pcmBuffer, sampleRate, traceId);

    if (!userText) {
      logger.info({ traceId }, "demo:process no speech detected");
      return Response.json({ text: "" });
    }

    logger.info(
      { traceId, textLength: userText.length },
      "demo:process transcribed"
    );

    // Step 2: Match
    const result = await matchQuestion(userText);

    logger.info(
      { traceId, category: result.category },
      "demo:process matched"
    );

    return Response.json({
      text: userText,
      ...result,
    });
  } catch (err) {
    return handleAppError(err, traceId);
  }
}
