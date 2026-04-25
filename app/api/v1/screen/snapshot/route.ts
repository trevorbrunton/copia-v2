import { handleAppError, NotFoundError } from "@/src/server/errors";
import { logger } from "@/src/lib/logger";
import { getActiveSnapshot } from "@/src/screen/snapshot-cache";

/**
 * GET /api/v1/screen/snapshot
 *
 * Bootstrap endpoint for the v2 demo client. Returns the active
 * snapshot's metadata plus every security row needed for client-side
 * display + state-machine reasoning. Called once on demo start.
 *
 * Active-snapshot resolution: MAX(collected_at) tiebroken by id, behind
 * an in-process TTL cache (see `src/screen/snapshot-cache.ts`).
 *
 * The `Cache-Control` header is set so Vercel's edge cache fronts the
 * route — repeat sessions on the same instance hit the in-process cache,
 * and across instances Vercel serves from the edge for ~5 minutes.
 *
 * Per D2: inline route pattern, no auth, no UoW.
 */
export async function GET() {
  const traceId = crypto.randomUUID();
  try {
    const snap = await getActiveSnapshot().catch((err) => {
      if (err instanceof Error && /No active ASX snapshot/.test(err.message)) {
        throw new NotFoundError("ASX snapshot");
      }
      throw err;
    });

    logger.info(
      { traceId, count: snap.securities.length, snapshotId: snap.meta.id },
      "screen:snapshot"
    );

    return Response.json(
      {
        snapshot: {
          id: snap.meta.id,
          date: snap.meta.date,
          collectedAt: snap.meta.collectedAt,
          stockCount: snap.meta.stockCount,
        },
        securities: snap.securities,
      },
      {
        headers: {
          // Edge caches the response for 5 min, serves stale for an hour.
          "Cache-Control":
            "public, max-age=60, s-maxage=300, stale-while-revalidate=3600",
        },
      }
    );
  } catch (err) {
    return handleAppError(err, traceId);
  }
}

export async function POST() {
  return new Response(null, { status: 405, headers: { Allow: "GET" } });
}
