/**
 * In-process cache for the active ASX snapshot.
 *
 * The snapshot table is append-only: a new row appears whenever the
 * ingest script runs, and the active snapshot is `MAX(collected_at)`
 * tiebroken by id. Both `/api/v1/screen/snapshot` and
 * `/api/v1/screen/apply-filter` were re-querying the full row set on
 * every request — this cache holds the parsed rows for `TTL_MS` and
 * collapses concurrent loads into a single in-flight promise.
 *
 * Single-process by design — same caveat as the rate limiter: each
 * Vercel/Node instance has its own copy. The TTL keeps memory bounded
 * and lets a fresh ingest land within a minute.
 *
 * **Layered caching note.** `/api/v1/screen/snapshot` also sets
 * `Cache-Control: s-maxage=300, stale-while-revalidate=3600` so Vercel's
 * edge fronts the route. The edge cache (5 min) intentionally outlives
 * this in-process cache (60s). Worst-case staleness as observed by a
 * client is the edge layer's 5 min — fine for daily-cadence snapshots,
 * and re-ingesting mid-pitch already requires a deliberate redeploy or
 * server restart anyway.
 */
import { desc, eq } from "drizzle-orm";
import { db } from "@/src/db";
import { asxSnapshots, asxSecurities } from "@/src/db/screen-schema";
import { parseNumeric } from "./numeric";
import type { FilterableSecurity } from "./funnel";
import { logger } from "@/src/lib/logger";

const TTL_MS = 60_000;

export interface SnapshotMeta {
  id: string;
  date: string;
  collectedAt: Date;
  stockCount: number;
}

/** The snapshot-route response shape — wide projection for client UI. */
export interface SecurityForClient {
  ticker: string;
  companyName: string | null;
  sector: string | null;
  gicsIndustryGroup: string | null;
  marketCap: string | null;
  closePrice: string | null;
  turnoverRatio: string | null;
  netIncomeTtm: string | null;
  freeCashFlowTtm: string | null;
  epsTtm: string | null;
  earningsStatus: string | null;
  isProfitable: boolean | null;
  isCashflowPositive: boolean | null;
  isAsx100: boolean | null;
  isUnprovenOrComplexTech: boolean | null;
  isSingleCommodityOrSingleMine: boolean | null;
  dataQuality: unknown;
}

interface CachedSnapshot {
  meta: SnapshotMeta;
  /** The shape /snapshot returns — pre-formatted to skip per-request work. */
  securities: SecurityForClient[];
  /** The shape /apply-filter needs, indexed for O(1) ticker lookup. */
  filterableByTicker: Map<string, FilterableSecurity>;
  /** The same FilterableSecurity rows as an array for full-universe filters. */
  filterableAll: FilterableSecurity[];
  fetchedAt: number;
}

let cache: CachedSnapshot | null = null;
let inFlight: Promise<CachedSnapshot> | null = null;

export async function getActiveSnapshot(): Promise<CachedSnapshot> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < TTL_MS) return cache;
  if (inFlight) return inFlight;
  inFlight = loadSnapshot().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/** Test-only: drop the cache so a fresh load runs. */
export function _resetSnapshotCacheForTests(): void {
  cache = null;
  inFlight = null;
}

async function loadSnapshot(): Promise<CachedSnapshot> {
  const t0 = Date.now();
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

  if (!active) throw new Error("No active ASX snapshot found");

  const rows = await db
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

  const securities: SecurityForClient[] = rows;

  const filterableAll: FilterableSecurity[] = rows.map((r) => ({
    ticker: r.ticker,
    market_cap_snapshot: parseNumeric(r.marketCap),
    turnover_ratio_ttm: parseNumeric(r.turnoverRatio),
    is_profitable: r.isProfitable,
    is_cashflow_positive: r.isCashflowPositive,
    is_asx_100: !!r.isAsx100,
    is_unproven_or_complex_tech: !!r.isUnprovenOrComplexTech,
    is_single_commodity_or_single_mine: !!r.isSingleCommodityOrSingleMine,
  }));

  const filterableByTicker = new Map<string, FilterableSecurity>();
  for (const r of filterableAll) filterableByTicker.set(r.ticker, r);

  const next: CachedSnapshot = {
    meta: {
      id: active.id,
      date: active.snapshotDate,
      collectedAt: active.collectedAt,
      stockCount: active.stockCount ?? rows.length,
    },
    securities,
    filterableByTicker,
    filterableAll,
    fetchedAt: Date.now(),
  };
  cache = next;
  logger.info(
    { snapshotId: next.meta.id, rows: rows.length, ms: Date.now() - t0 },
    "snapshot-cache:loaded"
  );
  return next;
}
