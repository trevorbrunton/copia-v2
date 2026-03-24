import { textToSpeech } from "@/src/demo/elevenlabs-client";
import { handleAppError, ValidationError } from "@/src/server/errors";
import { logger } from "@/src/lib/logger";

/** Max text length to send to ElevenLabs (roughly ~2 minutes of speech). */
const MAX_TEXT_LENGTH = 5000;

/**
 * POST /api/v1/demo/tts
 *
 * Converts text to speech using ElevenLabs. Streams the audio response.
 * Intentionally unauthenticated — this powers the public investor demo page.
 *
 * Body: { text: string; voiceId?: string }
 * Response: audio/mpeg stream
 */
export async function POST(req: Request) {
  const traceId = crypto.randomUUID();
  try {
    const body = await req.json();
    const text = typeof body.text === "string" ? body.text.trim() : "";
    const voiceId =
      typeof body.voiceId === "string" ? body.voiceId : undefined;

    if (!text) {
      throw new ValidationError("text is required");
    }
    if (text.length > MAX_TEXT_LENGTH) {
      throw new ValidationError(
        `text exceeds maximum length of ${MAX_TEXT_LENGTH} characters`
      );
    }

    logger.info({ traceId }, "demo:tts request");

    const audio = await textToSpeech(text, voiceId);

    const headers: Record<string, string> = {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "no-store",
    };
    if (audio.contentLength) {
      headers["Content-Length"] = audio.contentLength;
    }

    return new Response(audio.body, { headers });
  } catch (err) {
    return handleAppError(err, traceId);
  }
}
