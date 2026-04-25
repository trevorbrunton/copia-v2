/**
 * Ingest ASX snapshot files into the v2 demo schema.
 *
 * Reads:
 *   - $ASX_IMPORT_DIR/asx_universe.json         (~1,979 stocks: ticker + name + GICS)
 *   - $ASX_IMPORT_DIR/asx_ranked_light.json     (~1,840 enriched: mcap, price, volume)
 *   - $ASX_IMPORT_DIR/asx_top500_enriched.json  (top 500: + eps, net_income, fcf, sector)
 *   - data/curation.json                        (hand-curated boolean flags)
 *
 * Writes:
 *   - asx_snapshots (one new row)
 *   - asx_securities (upsert keyed on snapshot_id + ticker)
 *   - oc_holdings (sample portfolio for Q8 — fixed seed)
 *   - data/reports/ingest-{snapshot_date}.json (reconciliation summary)
 *
 * Exit codes:
 *   0 = success and counts match tests/screen/expected-preset-counts.json
 *   1 = ingest succeeded but counts drifted from the fixture
 *   2 = ingest failed
 *
 * Usage:  bun scripts/ingest-asx-snapshot.ts
 *         ASX_IMPORT_DIR=~/asx bun scripts/ingest-asx-snapshot.ts
 */
import postgres from "postgres";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve, join, dirname } from "path";

// ─── Configuration ─────────────────────────────────────────

const IMPORT_DIR = process.env.ASX_IMPORT_DIR
  ? resolve(process.env.ASX_IMPORT_DIR.replace(/^~/, process.env.HOME ?? "~"))
  : resolve("data/asx");

const FIXTURE_PATH = resolve("tests/screen/expected-preset-counts.json");
const REPORT_DIR = resolve("data/reports");
const CURATION_PATH = resolve("data/curation.json");

const SAMPLE_HOLDINGS = [
  { ticker: "MIN", weight: 6.30, mv: 8428900, firstBought: "2025-05-31", shareChg: 0.00, oneYr: 225.67, fwdPe: 14.64, sector: "Basic Materials" },
  { ticker: "CHC", weight: 6.24, mv: 8349675, firstBought: "2025-05-31", shareChg: -10.13, oneYr: 23.45, fwdPe: 19.12, sector: "Real Estate" },
  { ticker: "ORI", weight: 5.80, mv: 7769600, firstBought: "2025-05-31", shareChg: 0.00, oneYr: 36.61, fwdPe: 16.75, sector: "Basic Materials" },
  { ticker: "VCX", weight: 4.66, mv: 6233600, firstBought: "2025-05-31", shareChg: 0.00, oneYr: 15.13, fwdPe: 16.26, sector: "Real Estate" },
  { ticker: "NXT", weight: 4.59, mv: 6139700, firstBought: "2025-05-31", shareChg: 0.00, oneYr: 36.59, fwdPe: -39.53, sector: "Technology" },
  { ticker: "REA", weight: 4.31, mv: 5776785, firstBought: "2025-05-31", shareChg: 0.00, oneYr: -27.67, fwdPe: 31.65, sector: "Communication Services" },
  { ticker: "QUB", weight: 3.92, mv: 5247000, firstBought: "2025-05-31", shareChg: 60.58, oneYr: 31.14, fwdPe: 28.65, sector: "Industrials" },
  { ticker: "ALQ", weight: 3.87, mv: 5179400, firstBought: "2025-05-31", shareChg: 0.00, oneYr: 38.10, fwdPe: 23.92, sector: "Industrials" },
  { ticker: "SGH", weight: 3.69, mv: 4946925, firstBought: "2025-08-31", shareChg: 0.00, oneYr: -17.67, fwdPe: 13.55, sector: "Industrials" },
  { ticker: "A2M", weight: 3.68, mv: 4927350, firstBought: "2025-05-31", shareChg: 0.00, oneYr: -9.03, fwdPe: 21.83, sector: "Consumer Defensive" },
];
const SAMPLE_PORTFOLIO_LABEL = "OC Premium Small Company Fund (sample)";
const SAMPLE_AS_OF = "2025-12-31";

// ─── Source-row types (loose — JSON shapes vary across files) ───

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

// ─── Merged row used during ingest ─────────────────────────

type MergedRow = {
  ticker: string;
  company_name: string;
  sector: string | null;
  gics_industry_group: string | null;
  gics_sub_industry: string | null;
  market_cap_snapshot: number | null;
  close_price_snapshot: number | null;
  shares_outstanding: number | null;
  volume_latest: number | null;
  avg_volume_252d: number | null;
  total_volume_252d: number | null;
  turnover_ratio_ttm: number | null;
  eps_ttm: number | null;
  net_income_ttm: number | null;
  free_cash_flow_ttm: number | null;
  long_business_summary: string | null;
  // Derived
  earnings_status_snapshot: string;
  is_profitable: boolean | null;
  is_cashflow_positive: boolean | null;
  is_asx_100: boolean;
  // Curated
  is_unproven_or_complex_tech: boolean;
  is_single_commodity_or_single_mine: boolean;
  // Provenance
  data_quality: { enrichment_status: "ok" | "partial" | "failed"; missing_fields: string[] };
};

// ─── Helpers ───────────────────────────────────────────────

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

/**
 * Source JSONs use the string "N/A" as a sentinel for missing values in
 * fields that are otherwise numeric or text. Coerce to null so DB inserts
 * don't blow up on numeric columns.
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

function deriveEarningsStatus(netIncomeTtm: number | null): string {
  if (netIncomeTtm === null || netIncomeTtm === undefined) return "Insufficient data";
  return netIncomeTtm > 0 ? "Profitable (TTM)" : "Unprofitable (TTM)";
}

function classifyEnrichment(row: MergedRow): { enrichment_status: "ok" | "partial" | "failed"; missing_fields: string[] } {
  const required = {
    market_cap_snapshot: row.market_cap_snapshot,
    turnover_ratio_ttm: row.turnover_ratio_ttm,
    net_income_ttm: row.net_income_ttm,
  };
  const missing = Object.entries(required)
    .filter(([, v]) => v === null || v === undefined)
    .map(([k]) => k);
  if (missing.length === 0) return { enrichment_status: "ok", missing_fields: [] };
  if (missing.length === 3) return { enrichment_status: "failed", missing_fields: missing };
  return { enrichment_status: "partial", missing_fields: missing };
}

// ─── Filter sequences (mirror §4b of the plan) ─────────────

function applyQuestionnairePreset(rows: MergedRow[]): { stage: string; count: number; tickers: string[] }[] {
  const stages: { stage: string; count: number; tickers: string[] }[] = [];
  let current = rows;
  stages.push({ stage: "universe", count: current.length, tickers: current.map((r) => r.ticker) });

  // 1. mcap > 50m
  current = current.filter((r) => r.market_cap_snapshot !== null && r.market_cap_snapshot > 50_000_000);
  stages.push({ stage: "q1_mcap_50m", count: current.length, tickers: current.map((r) => r.ticker) });

  // 2. top 100 by mcap
  current = [...current].sort((a, b) => (b.market_cap_snapshot ?? 0) - (a.market_cap_snapshot ?? 0)).slice(0, 100);
  stages.push({ stage: "q2_top_100", count: current.length, tickers: current.map((r) => r.ticker) });

  // 3. turnover ≥ 20%
  current = current.filter((r) => r.turnover_ratio_ttm !== null && r.turnover_ratio_ttm >= 0.20);
  stages.push({ stage: "q3_turnover_20", count: current.length, tickers: current.map((r) => r.ticker) });

  // 4. profitable
  current = current.filter((r) => r.is_profitable === true);
  stages.push({ stage: "q4_profitable", count: current.length, tickers: current.map((r) => r.ticker) });

  // 5. unproven_tech (no-op when curation list is empty)
  current = current.filter((r) => !r.is_unproven_or_complex_tech);
  stages.push({ stage: "q5_unproven_tech", count: current.length, tickers: current.map((r) => r.ticker) });

  // 6. single_commodity
  current = current.filter((r) => !r.is_single_commodity_or_single_mine);
  stages.push({ stage: "q6_single_commodity", count: current.length, tickers: current.map((r) => r.ticker) });

  return stages;
}

function applyMethodologyPreset(rows: MergedRow[]): { stage: string; count: number; tickers: string[] }[] {
  const stages: { stage: string; count: number; tickers: string[] }[] = [];
  let current = rows;
  stages.push({ stage: "universe", count: current.length, tickers: current.map((r) => r.ticker) });

  // 1. mcap > 50m
  current = current.filter((r) => r.market_cap_snapshot !== null && r.market_cap_snapshot > 50_000_000);
  stages.push({ stage: "m1_mcap_50m", count: current.length, tickers: current.map((r) => r.ticker) });

  // 2. profitable
  current = current.filter((r) => r.is_profitable === true);
  stages.push({ stage: "m2_profitable", count: current.length, tickers: current.map((r) => r.ticker) });

  // 3. cash-flow positive
  current = current.filter((r) => r.is_cashflow_positive === true);
  stages.push({ stage: "m3_cashflow_positive", count: current.length, tickers: current.map((r) => r.ticker) });

  // 4. exclude unproven tech
  current = current.filter((r) => !r.is_unproven_or_complex_tech);
  stages.push({ stage: "m4_exclude_unproven_tech", count: current.length, tickers: current.map((r) => r.ticker) });

  // 5. exclude single commodity
  current = current.filter((r) => !r.is_single_commodity_or_single_mine);
  stages.push({ stage: "m5_exclude_single_commodity", count: current.length, tickers: current.map((r) => r.ticker) });

  // 6. sufficient liquidity (same proxy as questionnaire — see §12 #1)
  current = current.filter((r) => r.turnover_ratio_ttm !== null && r.turnover_ratio_ttm >= 0.20);
  stages.push({ stage: "m6_sufficient_liquidity", count: current.length, tickers: current.map((r) => r.ticker) });

  // 7. exclude ASX 100 (top 100 of the snapshot by mcap, computed once at row level)
  current = current.filter((r) => !r.is_asx_100);
  stages.push({ stage: "m7_exclude_asx_100", count: current.length, tickers: current.map((r) => r.ticker) });

  return stages;
}

// ─── Main ingest ───────────────────────────────────────────

async function main() {
  const databaseUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("✗ DIRECT_URL or DATABASE_URL must be set");
    process.exit(2);
  }

  console.log(`[ingest] Reading from ${IMPORT_DIR}`);
  const universe = readJson<{ securities: UniverseRow[]; collected_at: string }>(
    join(IMPORT_DIR, "asx_universe.json")
  );
  const ranked = readJson<{ securities: RankedLightRow[]; snapshot_date: string; collected_at: string }>(
    join(IMPORT_DIR, "asx_ranked_light.json")
  );
  const enriched = readJson<{ securities: TopEnrichedRow[] }>(
    join(IMPORT_DIR, "asx_top500_enriched.json")
  );
  const curation = readJson<Curation>(CURATION_PATH);

  const curatedUnproven = new Set(curation.is_unproven_or_complex_tech);
  const curatedSingleCommodity = new Set(curation.is_single_commodity_or_single_mine);

  // Index ranked-light + enriched by ticker
  const rankedByTicker = new Map(ranked.securities.map((r) => [r.ticker, r]));
  const enrichedByTicker = new Map(enriched.securities.map((r) => [r.ticker, r]));

  // Build the merged row set (universe defines membership). Source JSONs
  // sometimes use "N/A" / empty string as sentinels — normalise via num()/str().
  const merged: MergedRow[] = universe.securities.map((u) => {
    const r = rankedByTicker.get(u.ticker);
    const e = enrichedByTicker.get(u.ticker);
    const netIncome = num(e?.net_income_ttm);
    const fcf = num(e?.free_cash_flow_ttm);
    const row: MergedRow = {
      ticker: u.ticker,
      company_name: u.company_name,
      sector: str(e?.sector),
      gics_industry_group: str(u.gics_industry_group ?? r?.gics_industry_group),
      gics_sub_industry: str(e?.gics_sub_industry),
      market_cap_snapshot: num(r?.market_cap),
      close_price_snapshot: num(r?.close_price),
      shares_outstanding: num(r?.shares_outstanding),
      volume_latest: num(r?.volume_latest),
      avg_volume_252d: num(r?.avg_volume_252d),
      total_volume_252d: num(r?.total_volume_252d),
      turnover_ratio_ttm: num(r?.turnover_ratio_ttm),
      eps_ttm: num(e?.eps_ttm),
      net_income_ttm: netIncome,
      free_cash_flow_ttm: fcf,
      long_business_summary: str(e?.long_business_summary),
      earnings_status_snapshot: deriveEarningsStatus(netIncome),
      is_profitable: netIncome === null ? null : netIncome > 0,
      is_cashflow_positive: fcf === null ? null : fcf > 0,
      is_asx_100: false, // computed below
      is_unproven_or_complex_tech: curatedUnproven.has(u.ticker),
      is_single_commodity_or_single_mine: curatedSingleCommodity.has(u.ticker),
      data_quality: { enrichment_status: "failed", missing_fields: [] },
    };
    row.data_quality = classifyEnrichment(row);
    return row;
  });

  // Compute is_asx_100 (top 100 of this snapshot by market cap, NULLS LAST)
  const top100Tickers = new Set(
    [...merged]
      .filter((r) => r.market_cap_snapshot !== null)
      .sort((a, b) => (b.market_cap_snapshot ?? 0) - (a.market_cap_snapshot ?? 0))
      .slice(0, 100)
      .map((r) => r.ticker)
  );
  for (const r of merged) r.is_asx_100 = top100Tickers.has(r.ticker);

  // Apply both presets and capture stage counts
  const questionnaireStages = applyQuestionnairePreset(merged);
  const methodologyStages = applyMethodologyPreset(merged);

  // Reconciliation summary
  const enrichmentBreakdown = {
    ok: merged.filter((r) => r.data_quality.enrichment_status === "ok").length,
    partial: merged.filter((r) => r.data_quality.enrichment_status === "partial").length,
    failed: merged.filter((r) => r.data_quality.enrichment_status === "failed").length,
  };
  const flagBreakdown = {
    is_profitable_true: merged.filter((r) => r.is_profitable === true).length,
    is_cashflow_positive_true: merged.filter((r) => r.is_cashflow_positive === true).length,
    is_asx_100_true: merged.filter((r) => r.is_asx_100).length,
    is_unproven_or_complex_tech_true: merged.filter((r) => r.is_unproven_or_complex_tech).length,
    is_single_commodity_or_single_mine_true: merged.filter(
      (r) => r.is_single_commodity_or_single_mine
    ).length,
  };

  const snapshotDate = ranked.snapshot_date;
  const collectedAt = ranked.collected_at;
  const report = {
    snapshot_date: snapshotDate,
    collected_at: collectedAt,
    universe_size: merged.length,
    enrichment_breakdown: enrichmentBreakdown,
    flag_breakdown: flagBreakdown,
    questionnaire_preset: questionnaireStages.map(({ stage, count }) => ({ stage, count })),
    methodology_preset: methodologyStages.map(({ stage, count }) => ({ stage, count })),
    questionnaire_final_tickers: questionnaireStages[questionnaireStages.length - 1].tickers,
    methodology_final_tickers: methodologyStages[methodologyStages.length - 1].tickers,
  };

  // Write reconciliation report
  if (!existsSync(REPORT_DIR)) mkdirSync(REPORT_DIR, { recursive: true });
  const reportPath = join(REPORT_DIR, `ingest-${snapshotDate}.json`);
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n[ingest] Reconciliation report written to ${reportPath}`);

  // Print to stdout
  console.log("\n=== Reconciliation summary ===");
  console.log(`  Snapshot date:   ${snapshotDate}`);
  console.log(`  Collected at:    ${collectedAt}`);
  console.log(`  Universe size:   ${merged.length}`);
  console.log(`  Enrichment:      ok=${enrichmentBreakdown.ok}, partial=${enrichmentBreakdown.partial}, failed=${enrichmentBreakdown.failed}`);
  console.log(`  Profitable:      ${flagBreakdown.is_profitable_true}`);
  console.log(`  Cashflow +ve:    ${flagBreakdown.is_cashflow_positive_true}`);
  console.log(`  ASX 100:         ${flagBreakdown.is_asx_100_true}`);
  console.log(`  Single-cmdty:    ${flagBreakdown.is_single_commodity_or_single_mine_true}`);
  console.log("\n  Questionnaire preset stages:");
  for (const s of questionnaireStages) console.log(`    ${s.stage.padEnd(28)} ${s.count}`);
  console.log("\n  Methodology preset stages:");
  for (const s of methodologyStages) console.log(`    ${s.stage.padEnd(28)} ${s.count}`);

  // ─── Persist to DB ─────────────────────────────────────

  console.log(`\n[ingest] Connecting to database…`);
  const sql = postgres(databaseUrl, { prepare: false });

  try {
    // Idempotent: drop any prior snapshot for the same (date, source) so
    // re-runs replace cleanly. CASCADE drops dependent asx_securities rows.
    const sourceLabel = "merged_universe+ranked+enriched";
    const deleted = await sql<{ id: string }[]>`
      DELETE FROM asx_snapshots
      WHERE snapshot_date = ${snapshotDate} AND source = ${sourceLabel}
      RETURNING id
    `;
    if (deleted.length > 0) {
      console.log(`[ingest] Replaced ${deleted.length} prior snapshot row(s) for ${snapshotDate}`);
    }
    const [snapshot] = await sql<{ id: string }[]>`
      INSERT INTO asx_snapshots (snapshot_date, collected_at, source, stock_count, notes)
      VALUES (${snapshotDate}, ${collectedAt}, ${sourceLabel}, ${merged.length}, ${`Generated by scripts/ingest-asx-snapshot.ts on ${new Date().toISOString()}`})
      RETURNING id
    `;
    console.log(`[ingest] Snapshot row id = ${snapshot.id}`);

    // Bulk-upsert securities in chunks
    const CHUNK = 200;
    let written = 0;
    for (let i = 0; i < merged.length; i += CHUNK) {
      const chunk = merged.slice(i, i + CHUNK);
      const values = chunk.map((r) => ({
        snapshot_id: snapshot.id,
        ticker: r.ticker,
        company_name: r.company_name,
        sector: r.sector,
        gics_industry_group: r.gics_industry_group,
        gics_sub_industry: r.gics_sub_industry,
        market_cap_snapshot: r.market_cap_snapshot,
        close_price_snapshot: r.close_price_snapshot,
        shares_outstanding: r.shares_outstanding,
        volume_latest: r.volume_latest,
        avg_volume_252d: r.avg_volume_252d,
        total_volume_252d: r.total_volume_252d,
        turnover_ratio_ttm: r.turnover_ratio_ttm,
        eps_ttm: r.eps_ttm,
        net_income_ttm: r.net_income_ttm,
        free_cash_flow_ttm: r.free_cash_flow_ttm,
        long_business_summary: r.long_business_summary,
        earnings_status_snapshot: r.earnings_status_snapshot,
        is_profitable: r.is_profitable,
        is_cashflow_positive: r.is_cashflow_positive,
        is_asx_100: r.is_asx_100,
        is_unproven_or_complex_tech: r.is_unproven_or_complex_tech,
        is_single_commodity_or_single_mine: r.is_single_commodity_or_single_mine,
        data_quality: r.data_quality,
      }));
      await sql`
        INSERT INTO asx_securities ${sql(values)}
        ON CONFLICT (snapshot_id, ticker) DO UPDATE SET
          company_name = EXCLUDED.company_name,
          sector = EXCLUDED.sector,
          gics_industry_group = EXCLUDED.gics_industry_group,
          gics_sub_industry = EXCLUDED.gics_sub_industry,
          market_cap_snapshot = EXCLUDED.market_cap_snapshot,
          close_price_snapshot = EXCLUDED.close_price_snapshot,
          shares_outstanding = EXCLUDED.shares_outstanding,
          volume_latest = EXCLUDED.volume_latest,
          avg_volume_252d = EXCLUDED.avg_volume_252d,
          total_volume_252d = EXCLUDED.total_volume_252d,
          turnover_ratio_ttm = EXCLUDED.turnover_ratio_ttm,
          eps_ttm = EXCLUDED.eps_ttm,
          net_income_ttm = EXCLUDED.net_income_ttm,
          free_cash_flow_ttm = EXCLUDED.free_cash_flow_ttm,
          long_business_summary = EXCLUDED.long_business_summary,
          earnings_status_snapshot = EXCLUDED.earnings_status_snapshot,
          is_profitable = EXCLUDED.is_profitable,
          is_cashflow_positive = EXCLUDED.is_cashflow_positive,
          is_asx_100 = EXCLUDED.is_asx_100,
          is_unproven_or_complex_tech = EXCLUDED.is_unproven_or_complex_tech,
          is_single_commodity_or_single_mine = EXCLUDED.is_single_commodity_or_single_mine,
          data_quality = EXCLUDED.data_quality
      `;
      written += chunk.length;
      if (written % 1000 === 0 || written === merged.length) {
        console.log(`[ingest] Upserted ${written} / ${merged.length} securities`);
      }
    }

    // Upsert sample holdings
    console.log(`[ingest] Upserting ${SAMPLE_HOLDINGS.length} sample holdings`);
    const holdingValues = SAMPLE_HOLDINGS.map((h) => ({
      portfolio_label: SAMPLE_PORTFOLIO_LABEL,
      as_of_date: SAMPLE_AS_OF,
      ticker: h.ticker,
      weight_pct: h.weight,
      market_value_aud: h.mv,
      first_bought: h.firstBought,
      share_change_pct: h.shareChg,
      one_year_return_pct: h.oneYr,
      forward_pe: h.fwdPe,
      sector: h.sector,
      is_sample: true,
    }));
    await sql`
      INSERT INTO oc_holdings ${sql(holdingValues)}
      ON CONFLICT (portfolio_label, ticker, as_of_date) DO UPDATE SET
        weight_pct = EXCLUDED.weight_pct,
        market_value_aud = EXCLUDED.market_value_aud,
        first_bought = EXCLUDED.first_bought,
        share_change_pct = EXCLUDED.share_change_pct,
        one_year_return_pct = EXCLUDED.one_year_return_pct,
        forward_pe = EXCLUDED.forward_pe,
        sector = EXCLUDED.sector,
        is_sample = EXCLUDED.is_sample
    `;
    console.log(`[ingest] Sample holdings written.`);
  } finally {
    await sql.end();
  }

  // ─── Reconciliation against fixture ────────────────────

  if (!existsSync(FIXTURE_PATH)) {
    console.log(
      `\n⚠ tests/screen/expected-preset-counts.json does not exist yet. ` +
      `Snapshotting current counts as the baseline.`
    );
    if (!existsSync(dirname(FIXTURE_PATH))) mkdirSync(dirname(FIXTURE_PATH), { recursive: true });
    writeFileSync(
      FIXTURE_PATH,
      JSON.stringify(
        {
          _comment: "Expected per-stage counts for the v2 demo presets. Update only when the snapshot or filter rules intentionally change.",
          snapshot_date: snapshotDate,
          questionnaire_preset: report.questionnaire_preset,
          methodology_preset: report.methodology_preset,
        },
        null,
        2
      )
    );
    console.log(`✓ Fixture written to ${FIXTURE_PATH}. Re-run to verify.`);
    process.exit(0);
  }

  const fixture = readJson<{
    questionnaire_preset: { stage: string; count: number }[];
    methodology_preset: { stage: string; count: number }[];
  }>(FIXTURE_PATH);

  const drift: string[] = [];
  for (const expected of fixture.questionnaire_preset) {
    const actual = report.questionnaire_preset.find((s) => s.stage === expected.stage);
    if (!actual || actual.count !== expected.count) {
      drift.push(`questionnaire/${expected.stage}: expected ${expected.count}, got ${actual?.count ?? "MISSING"}`);
    }
  }
  for (const expected of fixture.methodology_preset) {
    const actual = report.methodology_preset.find((s) => s.stage === expected.stage);
    if (!actual || actual.count !== expected.count) {
      drift.push(`methodology/${expected.stage}: expected ${expected.count}, got ${actual?.count ?? "MISSING"}`);
    }
  }

  if (drift.length > 0) {
    console.error(`\n✗ Count drift detected vs ${FIXTURE_PATH}:`);
    for (const d of drift) console.error(`    ${d}`);
    console.error(
      `\nIf the drift is intentional (snapshot updated or filter rules changed), ` +
      `delete tests/screen/expected-preset-counts.json and re-run to re-baseline.`
    );
    process.exit(1);
  }

  console.log(`\n✓ All preset counts match fixture. Ingest complete.`);
}

main().catch((err) => {
  console.error("✗ Ingest failed:", err);
  process.exit(2);
});
