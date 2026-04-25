/**
 * Stock-fact provider abstraction (plan §6).
 *
 * The interface decouples consumers from the data source. v2 ships
 * exactly one implementation, `SnapshotMarketDataProvider`, which
 * reads from the active `asx_securities` snapshot. A future live
 * provider can slot in behind the same interface without touching
 * UI or routing code (D3).
 *
 * No `LiveMarketDataProvider` is committed in v2 by design (see plan
 * §6c) so the repo stays honest about what's implemented.
 */
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/src/db";
import { asxSnapshots, asxSecurities } from "@/src/db/screen-schema";
import { parseNumeric } from "@/src/screen/numeric";

export type StockFact = {
  ticker: string;
  companyName: string;
  /** Closing price from the snapshot. Currency is AUD for ASX-listed names. */
  sharePrice?: number;
  marketCap?: number;
  /** Derived from net_income TTM sign at ingest time — see plan §5b. */
  earningsStatus?: string;
  /** Not available from the snapshot in v2. Reserved for a future provider. */
  dayChangePct?: number;
  /** ISO-8601 timestamp the value relates to (snapshot's `collected_at`). */
  fetchedAt: string;
  /**
   * The snapshot's date as a YYYY-MM-DD string. Provided as a structured
   * field so consumers (e.g. `<SourceBadge>`) don't have to parse `source`.
   */
  snapshotDate: string;
  /** Human-readable display label, e.g. "Snapshot 2026-04-24". */
  source: string;
  /** Hard-coded false for v2 — every value is snapshot-sourced. */
  isLive: boolean;
};

export interface MarketDataProvider {
  /** Look up a ticker. Returns null if the ticker isn't in the active snapshot. */
  getStockFact(ticker: string): Promise<StockFact | null>;
}

/**
 * Snapshot-backed implementation. Picks the active snapshot via
 * `MAX(collected_at)` (tiebroken by id) and reads the matching
 * `asx_securities` row.
 */
export class SnapshotMarketDataProvider implements MarketDataProvider {
  async getStockFact(rawTicker: string): Promise<StockFact | null> {
    const ticker = rawTicker.trim().toUpperCase();
    if (!ticker) return null;

    const [active] = await db
      .select({
        id: asxSnapshots.id,
        snapshotDate: asxSnapshots.snapshotDate,
        collectedAt: asxSnapshots.collectedAt,
      })
      .from(asxSnapshots)
      .orderBy(desc(asxSnapshots.collectedAt), desc(asxSnapshots.id))
      .limit(1);
    if (!active) return null;

    const [row] = await db
      .select({
        ticker: asxSecurities.ticker,
        companyName: asxSecurities.companyName,
        marketCap: asxSecurities.marketCapSnapshot,
        closePrice: asxSecurities.closePriceSnapshot,
        earningsStatus: asxSecurities.earningsStatusSnapshot,
      })
      .from(asxSecurities)
      .where(and(eq(asxSecurities.snapshotId, active.id), eq(asxSecurities.ticker, ticker)))
      .limit(1);
    if (!row) return null;

    const fetchedAt =
      active.collectedAt instanceof Date
        ? active.collectedAt.toISOString()
        : new Date(active.collectedAt).toISOString();

    const sharePrice = parseNumeric(row.closePrice);
    const marketCap = parseNumeric(row.marketCap);

    return {
      ticker: row.ticker,
      companyName: row.companyName,
      sharePrice: sharePrice ?? undefined,
      marketCap: marketCap ?? undefined,
      earningsStatus: row.earningsStatus ?? undefined,
      // dayChangePct: not stored in v2 — would come from a live provider
      fetchedAt,
      snapshotDate: active.snapshotDate,
      source: `Snapshot ${active.snapshotDate}`,
      isLive: false,
    };
  }
}
