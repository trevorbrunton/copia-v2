/**
 * Snapshot-loading helpers for the v2 demo.
 *
 * Reads the three ASX source JSONs + the curation file, normalises the
 * shapes, derives the runtime flags (is_profitable, is_cashflow_positive,
 * is_asx_100, earnings_status_snapshot), and returns a merged row set
 * ready to be filtered or persisted.
 *
 * Lifted out of `scripts/ingest-asx-snapshot.ts` so the same loader is
 * shared by the script and the test suite (`tests/screen/*.test.ts`).
 */
import { readFileSync } from "fs";
import { join } from "path";
import { topNByMcapTickers, type FilterableSecurity } from "@/src/screen/funnel";

// ─── Public types ──────────────────────────────────────────

export type DataQuality = {
  enrichment_status: "ok" | "partial" | "failed";
  missing_fields: string[];
};

export type MergedRow = FilterableSecurity & {
  company_name: string;
  sector: string | null;
  gics_industry_group: string | null;
  gics_sub_industry: string | null;
  close_price_snapshot: number | null;
  shares_outstanding: number | null;
  volume_latest: number | null;
  avg_volume_252d: number | null;
  total_volume_252d: number | null;
  eps_ttm: number | null;
  net_income_ttm: number | null;
  free_cash_flow_ttm: number | null;
  long_business_summary: string | null;
  earnings_status_snapshot: string;
  data_quality: DataQuality;
};

export type SnapshotMetadata = {
  snapshot_date: string;
  collected_at: string;
};

// ─── Source-row shapes (loose — JSON shapes vary across files) ───

type UniverseRow = { ticker: string; company_name: string; gics_industry_group?: string };
type RankedLightRow = UniverseRow & {
  market_cap?: number; close_price?: number; currency?: string;
  shares_outstanding?: number; volume_latest?: number;
  avg_volume_252d?: number; total_volume_252d?: number;
  turnover_ratio_ttm?: number;
};
type TopEnrichedRow = RankedLightRow & {
  gics_sub_industry?: string; sector?: string;
  eps_ttm?: number; net_income_ttm?: number; free_cash_flow_ttm?: number;
  long_business_summary?: string;
};
type Curation = {
  is_unproven_or_complex_tech: string[];
  is_single_commodity_or_single_mine: string[];
};

// ─── Helpers ───────────────────────────────────────────────

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

/**
 * Source JSONs use the string "N/A" as a sentinel for missing values.
 * Coerce to null so DB inserts and numeric coercions don't blow up.
 */
function clean<T>(v: T): T | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" && (v === "N/A" || v === "NaN" || v === "")) return null;
  return v;
}
function num(v: unknown): number | null {
  const c = clean(v);
  if (c === null) return null;
  const n = typeof c === "number" ? c : Number(c);
  return Number.isFinite(n) ? n : null;
}
function str(v: unknown): string | null {
  const c = clean(v);
  return c === null ? null : String(c);
}

export function deriveEarningsStatus(netIncomeTtm: number | null): string {
  if (netIncomeTtm === null || netIncomeTtm === undefined) return "Insufficient data";
  return netIncomeTtm > 0 ? "Profitable (TTM)" : "Unprofitable (TTM)";
}

export function classifyEnrichment(args: {
  market_cap_snapshot: number | null;
  turnover_ratio_ttm: number | null;
  net_income_ttm: number | null;
}): DataQuality {
  const missing = Object.entries(args)
    .filter(([, v]) => v === null || v === undefined)
    .map(([k]) => k);
  if (missing.length === 0) return { enrichment_status: "ok", missing_fields: [] };
  if (missing.length === 3) return { enrichment_status: "failed", missing_fields: missing };
  return { enrichment_status: "partial", missing_fields: missing };
}

// ─── Loader ────────────────────────────────────────────────

export type SnapshotLoad = {
  snapshot: SnapshotMetadata;
  rows: MergedRow[];
};

/**
 * Load and merge the three source JSONs + curation, deriving runtime
 * flags. Returns the merged row set and snapshot metadata. No DB access.
 *
 * Universe defines membership: every row in `asx_universe.json` becomes
 * a `MergedRow`, with deeper enrichment from the other files merged on
 * `ticker` where available.
 */
export function loadSnapshot(args: { importDir: string; curationPath: string }): SnapshotLoad {
  const { importDir, curationPath } = args;

  const universe = readJson<{ securities: UniverseRow[]; collected_at: string }>(
    join(importDir, "asx_universe.json")
  );
  const ranked = readJson<{ securities: RankedLightRow[]; snapshot_date: string; collected_at: string }>(
    join(importDir, "asx_ranked_light.json")
  );
  const enriched = readJson<{ securities: TopEnrichedRow[] }>(
    join(importDir, "asx_top500_enriched.json")
  );
  const curation = readJson<Curation>(curationPath);

  const curatedUnproven = new Set(curation.is_unproven_or_complex_tech);
  const curatedSingleCommodity = new Set(curation.is_single_commodity_or_single_mine);

  const rankedByTicker = new Map(ranked.securities.map((r) => [r.ticker, r]));
  const enrichedByTicker = new Map(enriched.securities.map((r) => [r.ticker, r]));

  const rows: MergedRow[] = universe.securities.map((u) => {
    const r = rankedByTicker.get(u.ticker);
    const e = enrichedByTicker.get(u.ticker);
    const netIncome = num(e?.net_income_ttm);
    const fcf = num(e?.free_cash_flow_ttm);
    const marketCap = num(r?.market_cap);
    const turnover = num(r?.turnover_ratio_ttm);

    return {
      ticker: u.ticker,
      company_name: u.company_name,
      sector: str(e?.sector),
      gics_industry_group: str(u.gics_industry_group ?? r?.gics_industry_group),
      gics_sub_industry: str(e?.gics_sub_industry),
      market_cap_snapshot: marketCap,
      close_price_snapshot: num(r?.close_price),
      shares_outstanding: num(r?.shares_outstanding),
      volume_latest: num(r?.volume_latest),
      avg_volume_252d: num(r?.avg_volume_252d),
      total_volume_252d: num(r?.total_volume_252d),
      turnover_ratio_ttm: turnover,
      eps_ttm: num(e?.eps_ttm),
      net_income_ttm: netIncome,
      free_cash_flow_ttm: fcf,
      long_business_summary: str(e?.long_business_summary),
      earnings_status_snapshot: deriveEarningsStatus(netIncome),
      is_profitable: netIncome === null ? null : netIncome > 0,
      is_cashflow_positive: fcf === null ? null : fcf > 0,
      is_asx_100: false, // stamped below
      is_unproven_or_complex_tech: curatedUnproven.has(u.ticker),
      is_single_commodity_or_single_mine: curatedSingleCommodity.has(u.ticker),
      data_quality: classifyEnrichment({
        market_cap_snapshot: marketCap,
        turnover_ratio_ttm: turnover,
        net_income_ttm: netIncome,
      }),
    };
  });

  // Stamp is_asx_100 from the snapshot's own top-N by market cap.
  const top100 = topNByMcapTickers(rows);
  for (const row of rows) row.is_asx_100 = top100.has(row.ticker);

  return {
    snapshot: { snapshot_date: ranked.snapshot_date, collected_at: ranked.collected_at },
    rows,
  };
}
