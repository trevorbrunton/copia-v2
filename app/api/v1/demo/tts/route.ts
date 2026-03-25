import { handleAppError } from "@/src/server/errors";
import { ExternalServiceError } from "@/src/server/errors";
import { logger } from "@/src/lib/logger";

const VOICE_ID = process.env.ELEVENLABS_VOICE_ID ?? "";
const API_KEY = process.env.ELEVENLABS_API_KEY ?? "";
const MODEL_ID = "eleven_flash_v2";

/**
 * POST /api/v1/demo/tts
 *
 * Converts text to PCM 24kHz audio via ElevenLabs TTS API.
 * Returns base64-encoded PCM audio for LiveAvatar repeatAudio().
 * Intentionally unauthenticated — this powers the public investor demo page.
 */
export async function POST(req: Request) {
  const traceId = crypto.randomUUID();
  try {
    if (!API_KEY) {
      throw new ExternalServiceError(
        "ELEVENLABS_API_KEY is not configured",
        "elevenlabs"
      );
    }
    if (!VOICE_ID) {
      throw new ExternalServiceError(
        "ELEVENLABS_VOICE_ID is not configured",
        "elevenlabs"
      );
    }

    const body = await req.json();
    const text = body?.text;
    if (!text || typeof text !== "string") {
      return Response.json(
        { error: { code: "INVALID_INPUT", message: "text is required" } },
        { status: 400 }
      );
    }

    logger.info({ traceId, textLength: text.length }, "demo:tts request");

    const url = `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=pcm_24000`;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        model_id: MODEL_ID,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new ExternalServiceError(
        `ElevenLabs TTS error: ${res.status} ${errBody}`,
        "elevenlabs"
      );
    }

    const buffer = await res.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");

    return Response.json({ audio: base64 });
  } catch (err) {
    return handleAppError(err, traceId);
  }
}
