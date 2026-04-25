import { z } from "zod";
import { handleAppError, ValidationError } from "@/src/server/errors";
import { logger } from "@/src/lib/logger";
import { matchScreenIntent } from "@/src/screen/screen-matcher";
import { EntityResolver } from "@/src/screen/entity-resolver";
import { transcribePcm } from "@/src/screen/stt";
import type { Intent } from "@/src/screen/intent";

/**
 * POST /api/v1/screen/process
 *
 * Classify a user utterance into a structured `Intent`. For
 * `info_stock_field` intents, additionally resolve a ticker via the
 * snapshot-backed entity resolver (plan §4c).
 *
 * Two input modes:
 *   - JSON: `{ text: string }`
 *   - multipart/form-data: `audio` (PCM blob) + `sampleRate` (number).
 *     Server transcribes via ElevenLabs `scribe_v1`, then classifies.
 *
 * Returns `{ text, intent }` in both modes. The `text` field carries
 * the transcribed (or supplied) utterance so the client can show it
 * in the chat transcript.
 *
 * Per D2: inline route pattern, no auth, no UoW. Public route.
 */

const JsonBodySchema = z.object({
  text: z.string().min(1).max(500),
});

// Module-level singleton — entity resolver caches snapshot data.
const entityResolver = new EntityResolver();

const MAX_AUDIO_BYTES = 10_000_000;

async function readUtteranceText(req: Request, traceId: string): Promise<string> {
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.startsWith("multipart/form-data")) {
    const form = await req.formData();
    const audio = form.get("audio");
    const sampleRateRaw = form.get("sampleRate");
    if (!(audio instanceof Blob)) {
      throw new ValidationError("audio is required (multipart Blob)");
    }
    const sampleRate = parseInt(String(sampleRateRaw ?? "48000"), 10);
    if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192_000) {
      throw new ValidationError(`sampleRate must be between 8000 and 192000 (got ${sampleRateRaw})`);
    }
    const pcm = await audio.arrayBuffer();
    if (pcm.byteLength > MAX_AUDIO_BYTES) {
      throw new ValidationError(
        `audio exceeds maximum size of ${MAX_AUDIO_BYTES} bytes`
      );
    }
    logger.info(
      { traceId, audioBytes: pcm.byteLength, sampleRate },
      "screen:process transcribe"
    );
    return await transcribePcm({ pcm, sampleRate, traceId });
  }
  // JSON path
  const raw = await req.json().catch(() => ({}));
  return JsonBodySchema.parse(raw).text;
}

export async function POST(req: Request) {
  const traceId = crypto.randomUUID();
  try {
    const text = await readUtteranceText(req, traceId);

    if (!text) {
      // Voice input with no detected speech — return a `fallback` intent
      // so the client can ignore gracefully without a hard error.
      return Response.json({ text: "", intent: { kind: "fallback" } });
    }

    const intent = await matchScreenIntent(text);

    // Entity resolution for info_stock_field — resolve ticker if not
    // already supplied by the rule layer.
    let enriched: Intent = intent;
    if (intent.kind === "info_stock_field" && !intent.ticker) {
      const resolved = await entityResolver.resolve(text);
      if (resolved) {
        enriched = { ...intent, ticker: resolved.ticker };
      }
    }

    logger.info(
      {
        traceId,
        kind: enriched.kind,
        textLength: text.length,
        ...(enriched.kind === "apply_filter" && { filterId: enriched.filterId }),
        ...(enriched.kind === "info_stock_field" && {
          ticker: enriched.ticker,
          field: enriched.field,
        }),
      },
      "screen:process"
    );

    return Response.json({ text, intent: enriched });
  } catch (err) {
    return handleAppError(err, traceId);
  }
}

export async function GET() {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}
