import { handleAppError } from "@/src/server/errors";
import { ExternalServiceError } from "@/src/server/errors";
import { logger } from "@/src/lib/logger";

/**
 * DELETE /api/v1/demo/tavus/[conversationId]
 *
 * Ends a Tavus CVI conversation server-side so it stops billing.
 * Intentionally unauthenticated — powers the public investor demo page.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  const traceId = crypto.randomUUID();
  try {
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
