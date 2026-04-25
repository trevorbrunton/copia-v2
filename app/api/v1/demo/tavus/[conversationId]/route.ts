import { handleAppError } from "@/src/server/errors";
import { ExternalServiceError } from "@/src/server/errors";
import { logger } from "@/src/lib/logger";
import { checkRateLimit } from "@/src/server/rate-limit";
import { getClientIp } from "@/src/lib/api-response";

// DELETE is cheap (one outbound call to Tavus to stop billing) but is
// still an unauthenticated route. Bound it loosely.
const RATE_LIMITS = [
  { limit: 30, windowMs: 60_000 },        // 30 / minute
  { limit: 100, windowMs: 60 * 60_000 },  // 100 / hour
] as const;

/**
 * DELETE /api/v1/demo/tavus/[conversationId]
 *
 * Ends a Tavus CVI conversation server-side so it stops billing.
 * Intentionally unauthenticated — powers the public investor demo page.
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  const traceId = crypto.randomUUID();
  try {
    checkRateLimit(`demo:tavus:delete:${getClientIp(req)}`, RATE_LIMITS);
    const { conversationId } = await params;

    const apiKey = process.env.TAVUS_API_KEY;
    if (!apiKey) {
      throw new ExternalServiceError(
        "TAVUS_API_KEY is not configured",
        "tavus"
      );
    }

    logger.info(
      { traceId, conversationId },
      "demo:tavus ending conversation"
    );

    const res = await fetch(
      `https://tavusapi.com/v2/conversations/${conversationId}`,
      {
        method: "DELETE",
        headers: { "x-api-key": apiKey },
        signal: AbortSignal.timeout(10_000),
      }
    );

    if (!res.ok && res.status !== 404) {
      const body = await res.json().catch(() => null);
      throw new ExternalServiceError(
        `Tavus API error: ${res.status} ${body?.message ?? res.statusText}`,
        "tavus"
      );
    }

    logger.info(
      { traceId, conversationId, status: res.status },
      "demo:tavus conversation ended"
    );

    return Response.json({ success: true });
  } catch (err) {
    return handleAppError(err, traceId);
  }
}
