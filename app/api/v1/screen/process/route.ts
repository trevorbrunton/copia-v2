import { z } from "zod";
import { handleAppError } from "@/src/server/errors";
import { logger } from "@/src/lib/logger";
import { matchScreenIntent } from "@/src/screen/screen-matcher";
import { EntityResolver } from "@/src/screen/entity-resolver";
import type { Intent } from "@/src/screen/intent";

/**
 * POST /api/v1/screen/process
 *
 * Classify a user utterance into a structured `Intent`. For
 * `info_stock_field` intents, additionally resolve a ticker via the
 * snapshot-backed entity resolver (plan §4c).
 *
 * The route is intent-only — it does not execute side effects. The
 * client orchestrates by calling the existing routes (`/apply-filter`,
 * `/stock-fact`, etc.) based on the returned intent.
 *
 * Body:    { text: string }
 * Returns: { text: string, intent: Intent }
 *
 * Per D2: inline route pattern, no auth, no UoW. Public route.
 */

const BodySchema = z.object({
  text: z.string().min(1).max(500),
});

// Module-level singleton — entity resolver caches snapshot data.
const entityResolver = new EntityResolver();

export async function POST(req: Request) {
  const traceId = crypto.randomUUID();
  try {
    const raw = await req.json().catch(() => ({}));
    const { text } = BodySchema.parse(raw);

    const intent = await matchScreenIntent(text);

    // Entity resolution for info_stock_field — resolve ticker if not
    // already supplied by the rule layer (rules don't extract tickers
    // today; the resolver does).
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
        // Conditionally log identifying detail per intent
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
