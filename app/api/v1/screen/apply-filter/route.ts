import { z } from "zod";
import { handleAppError, NotFoundError } from "@/src/server/errors";
import { logger } from "@/src/lib/logger";
import {
  applyOneFilter,
  isFilterId,
  makeStage,
  type FilterId,
  type FilterableSecurity,
} from "@/src/screen/funnel";
import { getActiveSnapshot } from "@/src/screen/snapshot-cache";

/**
 * POST /api/v1/screen/apply-filter
 *
 * Stateless single-filter step. The client supplies a filterId and,
 * optionally, the ticker shortlist from the previous stage. The server
 * returns the resulting Stage plus active-snapshot metadata. The client
 * accumulates Stages into its ScreenState (see src/screen/state.ts).
 *
 * If `fromTickers` is omitted, the filter operates on the full universe.
 *
 * Body:   { filterId: FilterId, fromTickers?: string[] }
 * Returns { stage: Stage, snapshot: { id, date, collectedAt } }
 *
 * Reads from the in-process snapshot cache — see snapshot-cache.ts.
 *
 * Per D2: inline route pattern, no auth, no UoW.
 */

const BodySchema = z.object({
  filterId: z.string().refine(isFilterId, { message: "Invalid filterId" }),
  fromTickers: z.array(z.string()).optional(),
});

export async function POST(req: Request) {
  const traceId = crypto.randomUUID();
  try {
    const raw = await req.json().catch(() => ({}));
    const { filterId, fromTickers } = BodySchema.parse(raw) as {
      filterId: FilterId;
      fromTickers?: string[];
    };

    const snap = await getActiveSnapshot().catch((err) => {
      if (err instanceof Error && /No active ASX snapshot/.test(err.message)) {
        throw new NotFoundError("ASX snapshot");
      }
      throw err;
    });

    let rows: FilterableSecurity[];
    if (fromTickers && fromTickers.length > 0) {
      rows = [];
      for (const t of fromTickers) {
        const r = snap.filterableByTicker.get(t);
        if (r) rows.push(r);
      }
    } else {
      rows = snap.filterableAll;
    }

    logger.info(
      { traceId, filterId, inputCount: rows.length, fromSubset: !!fromTickers },
      "screen:apply-filter"
    );

    const filtered = applyOneFilter(rows, filterId);
    const stage = makeStage(filterId, filtered);

    return Response.json({
      stage,
      snapshot: {
        id: snap.meta.id,
        date: snap.meta.date,
        collectedAt: snap.meta.collectedAt,
      },
    });
  } catch (err) {
    return handleAppError(err, traceId);
  }
}

/**
 * Restrict to JSON POST. Other methods 405.
 */
export async function GET() {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}
