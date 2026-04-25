import { z } from "zod";
import { and, desc, eq, inArray } from "drizzle-orm";
import { handleAppError, NotFoundError } from "@/src/server/errors";
import { logger } from "@/src/lib/logger";
import { db } from "@/src/db";
import { asxSnapshots, asxSecurities } from "@/src/db/screen-schema";
import {
  applyOneFilter,
  isFilterId,
  makeStage,
  type FilterId,
  type FilterableSecurity,
} from "@/src/screen/funnel";
import { parseNumeric } from "@/src/screen/numeric";

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

    // 1. Resolve active snapshot (MAX(collected_at)) — see plan §6b.
    //    Tiebreak on id so two snapshots inserted in the same second
    //    still resolve deterministically.
    const [active] = await db
      .select({
        id: asxSnapshots.id,
        snapshotDate: asxSnapshots.snapshotDate,
        collectedAt: asxSnapshots.collectedAt,
      })
      .from(asxSnapshots)
      .orderBy(desc(asxSnapshots.collectedAt), desc(asxSnapshots.id))
      .limit(1);

    if (!active) {
      throw new NotFoundError("ASX snapshot");
    }

    // 2. Fetch the rows scoped to the requested ticker subset (or all
    //    rows for this snapshot when no `fromTickers` is given).
    const where = fromTickers && fromTickers.length > 0
      ? and(eq(asxSecurities.snapshotId, active.id), inArray(asxSecurities.ticker, fromTickers))
      : eq(asxSecurities.snapshotId, active.id);

    const rawRows = await db
      .select({
        ticker: asxSecurities.ticker,
        market_cap_snapshot: asxSecurities.marketCapSnapshot,
        turnover_ratio_ttm: asxSecurities.turnoverRatioTtm,
        is_profitable: asxSecurities.isProfitable,
        is_cashflow_positive: asxSecurities.isCashflowPositive,
        is_asx_100: asxSecurities.isAsx100,
        is_unproven_or_complex_tech: asxSecurities.isUnprovenOrComplexTech,
        is_single_commodity_or_single_mine: asxSecurities.isSingleCommodityOrSingleMine,
      })
      .from(asxSecurities)
      .where(where);

    // Drizzle returns Postgres `numeric` columns as strings. Coerce to
    // JS numbers via a strict parser that returns null on anything that
    // isn't a finite number (never NaN, which would silently affect filter
    // results).
    const rows: FilterableSecurity[] = rawRows.map((r) => ({
      ticker: r.ticker,
      market_cap_snapshot: parseNumeric(r.market_cap_snapshot),
      turnover_ratio_ttm: parseNumeric(r.turnover_ratio_ttm),
      is_profitable: r.is_profitable,
      is_cashflow_positive: r.is_cashflow_positive,
      is_asx_100: !!r.is_asx_100,
      is_unproven_or_complex_tech: !!r.is_unproven_or_complex_tech,
      is_single_commodity_or_single_mine: !!r.is_single_commodity_or_single_mine,
    }));

    logger.info(
      { traceId, filterId, inputCount: rows.length, fromSubset: !!fromTickers },
      "screen:apply-filter"
    );

    // 3. Apply the filter and build the resulting stage.
    const filtered = applyOneFilter(rows, filterId);
    const stage = makeStage(filterId, filtered);

    return Response.json({
      stage,
      snapshot: {
        id: active.id,
        date: active.snapshotDate,
        collectedAt: active.collectedAt,
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
