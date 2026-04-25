import { z } from "zod";
import {
  ExternalServiceError,
  handleAppError,
} from "@/src/server/errors";
import { logger } from "@/src/lib/logger";
import { checkRateLimit } from "@/src/server/rate-limit";
import { getClientIp } from "@/src/lib/api-response";

/**
 * POST /api/v1/screen/tts
 *
 * Synthesises an utterance via ElevenLabs and returns base64 PCM at
 * 24 kHz mono — the format Tavus expects for Audio Echo events. The
 * client wraps the bytes in `conversation.echo` Daily app-messages and
 * Tavus's replica lip-syncs without ever hitting its own TTS layer
 * (Cartesia), so voice consistency is fully under our control.
 *
 * Body:    { text: string }
 * Returns: { audio: base64, sampleRate: 24000, inferenceId: uuid }
 *
 * Per D2: inline route pattern, no auth, no UoW. IP rate-limited the
 * same way as /screen/process — these calls map 1:1 to assistant
 * utterances and burn paid ElevenLabs credits.
 */

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY ?? "";
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID ?? "";
const MODEL_ID = process.env.ELEVENLABS_MODEL_ID || "eleven_turbo_v2_5";
const SAMPLE_RATE = 24_000;

const RATE_LIMITS = [
  { limit: 30, windowMs: 60_000 },        // 30 / minute
  { limit: 200, windowMs: 60 * 60_000 },  // 200 / hour
] as const;

const BodySchema = z.object({
  text: z.string().min(1).max(2000),
});

export async function POST(req: Request) {
  const traceId = crypto.randomUUID();
  try {
    checkRateLimit(`screen:tts:${getClientIp(req)}`, RATE_LIMITS);

    if (!ELEVENLABS_API_KEY) {
      throw new ExternalServiceError(
        "ELEVENLABS_API_KEY is not configured",
        "elevenlabs"
      );
    }
    if (!ELEVENLABS_VOICE_ID) {
      throw new ExternalServiceError(
        "ELEVENLABS_VOICE_ID is not configured",
        "elevenlabs"
      );
    }

    const raw = await req.json().catch(() => ({}));
    const { text } = BodySchema.parse(raw);

    const inferenceId = crypto.randomUUID();
    const t0 = Date.now();

    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}?output_format=pcm_${SAMPLE_RATE}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": ELEVENLABS_API_KEY,
          "Content-Type": "application/json",
          Accept: "audio/pcm",
        },
        body: JSON.stringify({
          text,
          model_id: MODEL_ID,
        }),
        signal: AbortSignal.timeout(15_000),
      }
    );

    if (!res.ok) {
      const errBody = await res.text();
      logger.error(
        { traceId, status: res.status, body: errBody },
        "screen:tts elevenlabs failed"
      );
      throw new ExternalServiceError(
        `ElevenLabs TTS error: ${res.status} ${errBody}`,
        "elevenlabs"
      );
    }

    const audioBuf = await res.arrayBuffer();
    const base64 = Buffer.from(audioBuf).toString("base64");

    logger.info(
      {
        traceId,
        inferenceId,
        textLength: text.length,
        audioBytes: audioBuf.byteLength,
        sampleRate: SAMPLE_RATE,
        model: MODEL_ID,
        ms: Date.now() - t0,
      },
      "screen:tts"
    );

    return Response.json({
      audio: base64,
      sampleRate: SAMPLE_RATE,
      inferenceId,
    });
  } catch (err) {
    return handleAppError(err, traceId);
  }
}

export async function GET() {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}
