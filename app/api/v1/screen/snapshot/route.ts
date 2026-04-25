import { desc, eq } from "drizzle-orm";
import { handleAppError, NotFoundError } from "@/src/server/errors";
import { logger } from "@/src/lib/logger";
import { db } from "@/src/db";
import { asxSnapshots, asxSecurities } from "@/src/db/screen-schema";

/**
 * GET /api/v1/screen/snapshot
 *
 * Bootstrap endpoint for the v2 demo client. Returns the active
 * snapshot's metadata plus every security row needed for client-side
 * display + state-machine reasoning. Called once on demo start.
 *
 * Active-snapshot resolution: MAX(collected_at) tiebroken by id.
 *
 * Per D2: inline route pattern, no auth, no UoW.
 */

export async function GET() {
  const traceId = crypto.randomUUID();
  try {
    const [active] = await db
      .select({
        id: asxSnapshots.id,
        snapshotDate: asxSnapshots.snapshotDate,
        collectedAt: asxSnapshots.collectedAt,
        stockCount: asxSnapshots.stockCount,
      })
      .from(asxSnapshots)
      .orderBy(desc(asxSnapshots.collectedAt), desc(asxSnapshots.id))
      .limit(1);

    if (!active) throw new NotFoundError("ASX snapshot");

    const securities = await db
      .select({
        ticker: asxSecurities.ticker,
        companyName: asxSecurities.companyName,
        sector: asxSecurities.sector,
        gicsIndustryGroup: asxSecurities.gicsIndustryGroup,
        marketCap: asxSecurities.marketCapSnapshot,
        closePrice: asxSecurities.closePriceSnapshot,
        turnoverRatio: asxSecurities.turnoverRatioTtm,
        netIncomeTtm: asxSecurities.netIncomeTtm,
        freeCashFlowTtm: asxSecurities.freeCashFlowTtm,
        epsTtm: asxSecurities.epsTtm,
        earningsStatus: asxSecurities.earningsStatusSnapshot,
        isProfitable: asxSecurities.isProfitable,
        isCashflowPositive: asxSecurities.isCashflowPositive,
        isAsx100: asxSecurities.isAsx100,
        isUnprovenOrComplexTech: asxSecurities.isUnprovenOrComplexTech,
        isSingleCommodityOrSingleMine: asxSecurities.isSingleCommodityOrSingleMine,
        dataQuality: asxSecurities.dataQuality,
      })
      .from(asxSecurities)
      .where(eq(asxSecurities.snapshotId, active.id));

    logger.info({ traceId, count: securities.length, snapshotId: active.id }, "screen:snapshot");

    return Response.json({
      snapshot: {
        id: active.id,
        date: active.snapshotDate,
        collectedAt: active.collectedAt,
        stockCount: active.stockCount,
      },
      securities,
    });
  } catch (err) {
    return handleAppError(err, traceId);
  }
}

export async function POST() {
  return new Response(null, { status: 405, headers: { Allow: "GET" } });
}
