/**
 * Ingest ASX snapshot files into the v2 demo schema.
 *
 * Reads:
 *   - $ASX_IMPORT_DIR/asx_universe.json         (~1,979 stocks: ticker + name + GICS)
 *   - $ASX_IMPORT_DIR/asx_ranked_light.json     (~1,840 enriched: mcap, price, volume)
 *   - $ASX_IMPORT_DIR/asx_top500_enriched.json  (top 500: + eps, net_income, fcf, sector)
 *   - data/curation.json                        (hand-curated boolean flags)
 *
 * Run order:
 *   1. Load JSONs and build the in-memory merged row set.
 *   2. Compute derived flags + apply both presets in memory.
 *   3. Validate the resulting per-stage counts against the committed
 *      fixture (`tests/screen/expected-preset-counts.json`). If drift is
 *      detected, exit non-zero **before** touching the database.
 *   4. Persist to DB (snapshot + securities + sample holdings) idempotently.
 *   5. Write the reconciliation report.
 *
 * Writes:
 *   - asx_snapshots (replaces prior row for the same date+source)
 *   - asx_securities (upsert keyed on snapshot_id + ticker)
 *   - oc_holdings (upsert — sample portfolio for Q8)
 *   - data/reports/ingest-{snapshot_date}.json (audit trail)
 *
 * Flags:
 *   --baseline  Create or overwrite the fixture from the current run's
 *               counts. Use this only when the snapshot or filter rules
 *               have intentionally changed and the new counts have been
 *               manually verified.
 *
 * Exit codes:
 *   0 = success and counts match fixture
 *   1 = counts drifted from fixture (DB NOT updated)
 *   2 = ingest failed
 *
 * Usage:
 *   bun scripts/ingest-asx-snapshot.ts
 *   bun scripts/ingest-asx-snapshot.ts --baseline
 *   ASX_IMPORT_DIR=~/asx bun scripts/ingest-asx-snapshot.ts
 */
import postgres from "postgres";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve, join, dirname } from "path";
import {
  applyMethodologyPreset,
  applyQuestionnairePreset,
  type Stage,
} from "@/src/screen/funnel";
import { loadSnapshot, type MergedRow } from "@/src/screen/load-snapshot";

// ─── Configuration ─────────────────────────────────────────

const IMPORT_DIR = process.env.ASX_IMPORT_DIR
  ? resolve(process.env.ASX_IMPORT_DIR.replace(/^~/, process.env.HOME ?? "~"))
  : resolve("data/asx");

const FIXTURE_PATH = resolve("tests/screen/expected-preset-counts.json");
const REPORT_DIR = resolve("data/reports");
const CURATION_PATH = resolve("data/curation.json");

const SOURCE_LABEL = "merged_universe+ranked+enriched";

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

// ─── Helpers ───────────────────────────────────────────────

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

function stagesToFixtureShape(stages: Stage[]): { stage: string; count: number }[] {
  return stages.map(({ id, count }) => ({ stage: id, count }));
}

function buildReport(merged: MergedRow[], snapshotDate: string, collectedAt: string) {
  const questionnaireStages = applyQuestionnairePreset(merged);
  const methodologyStages = applyMethodologyPreset(merged);

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

  return {
    snapshot_date: snapshotDate,
    collected_at: collectedAt,
    universe_size: merged.length,
    enrichment_breakdown: enrichmentBreakdown,
    flag_breakdown: flagBreakdown,
    questionnaire_preset: stagesToFixtureShape(questionnaireStages),
    methodology_preset: stagesToFixtureShape(methodologyStages),
    questionnaire_final_tickers: questionnaireStages[questionnaireStages.length - 1].tickers,
    methodology_final_tickers: methodologyStages[methodologyStages.length - 1].tickers,
  };
}

function printSummary(report: ReturnType<typeof buildReport>) {
  console.log("\n=== Reconciliation summary ===");
  console.log(`  Snapshot date:   ${report.snapshot_date}`);
  console.log(`  Collected at:    ${report.collected_at}`);
  console.log(`  Universe size:   ${report.universe_size}`);
  console.log(
    `  Enrichment:      ok=${report.enrichment_breakdown.ok}, ` +
      `partial=${report.enrichment_breakdown.partial}, ` +
      `failed=${report.enrichment_breakdown.failed}`
  );
  console.log(`  Profitable:      ${report.flag_breakdown.is_profitable_true}`);
  console.log(`  Cashflow +ve:    ${report.flag_breakdown.is_cashflow_positive_true}`);
  console.log(`  ASX 100:         ${report.flag_breakdown.is_asx_100_true}`);
  console.log(
    `  Single-cmdty:    ${report.flag_breakdown.is_single_commodity_or_single_mine_true}`
  );
  console.log("\n  Questionnaire preset stages:");
  for (const s of report.questionnaire_preset) console.log(`    ${s.stage.padEnd(28)} ${s.count}`);
  console.log("\n  Methodology preset stages:");
  for (const s of report.methodology_preset) console.log(`    ${s.stage.padEnd(28)} ${s.count}`);
}

/**
 * Validate report counts against the committed fixture. Returns true if
 * the fixture was used (drift detection ran), false if the user explicitly
 * baselined a new fixture. Exits the process on drift or on a missing
 * fixture without --baseline.
 */
function validateOrBaseline(
  report: ReturnType<typeof buildReport>,
  options: { baseline: boolean }
): void {
  if (options.baseline) {
    if (!existsSync(dirname(FIXTURE_PATH))) mkdirSync(dirname(FIXTURE_PATH), { recursive: true });
    writeFileSync(
      FIXTURE_PATH,
      JSON.stringify(
        {
          _comment:
            "Expected per-stage counts for the v2 demo presets. Update only when the snapshot or filter rules intentionally change. Re-baseline with `bun scripts/ingest-asx-snapshot.ts --baseline`.",
          snapshot_date: report.snapshot_date,
          questionnaire_preset: report.questionnaire_preset,
          methodology_preset: report.methodology_preset,
        },
        null,
        2
      ) + "\n"
    );
    console.log(`✓ Fixture written to ${FIXTURE_PATH}`);
    return;
  }

  if (!existsSync(FIXTURE_PATH)) {
    console.error(
      `\n✗ Fixture not found at ${FIXTURE_PATH}.\n` +
        `  This file is required to detect count drift. To create it from\n` +
        `  the current run, re-run with the --baseline flag:\n\n` +
        `    bun scripts/ingest-asx-snapshot.ts --baseline\n`
    );
    process.exit(2);
  }

  const fixture = readJson<{
    questionnaire_preset: { stage: string; count: number }[];
    methodology_preset: { stage: string; count: number }[];
  }>(FIXTURE_PATH);

  const drift: string[] = [];
  for (const expected of fixture.questionnaire_preset) {
    const actual = report.questionnaire_preset.find((s) => s.stage === expected.stage);
    if (!actual || actual.count !== expected.count) {
      drift.push(
        `questionnaire/${expected.stage}: expected ${expected.count}, got ${actual?.count ?? "MISSING"}`
      );
    }
  }
  for (const expected of fixture.methodology_preset) {
    const actual = report.methodology_preset.find((s) => s.stage === expected.stage);
    if (!actual || actual.count !== expected.count) {
      drift.push(
        `methodology/${expected.stage}: expected ${expected.count}, got ${actual?.count ?? "MISSING"}`
      );
    }
  }

  if (drift.length > 0) {
    console.error(`\n✗ Count drift detected vs ${FIXTURE_PATH}:`);
    for (const d of drift) console.error(`    ${d}`);
    console.error(
      `\nDB was NOT updated. If this drift is intentional (snapshot or rules\n` +
        `changed), re-run with --baseline after manually verifying the new counts.`
    );
    process.exit(1);
  }

  console.log(`\n✓ All preset counts match fixture (${FIXTURE_PATH}).`);
}

async function persist(merged: MergedRow[], snapshotDate: string, collectedAt: string) {
  const databaseUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DIRECT_URL or DATABASE_URL must be set");

  console.log(`\n[ingest] Connecting to database…`);
  const sql = postgres(databaseUrl, { prepare: false });

  try {
    // Idempotent: drop any prior snapshot for the same (date, source) so
    // re-runs replace cleanly. CASCADE drops dependent asx_securities rows.
    const deleted = await sql<{ id: string }[]>`
      DELETE FROM asx_snapshots
      WHERE snapshot_date = ${snapshotDate} AND source = ${SOURCE_LABEL}
      RETURNING id
    `;
    if (deleted.length > 0) {
      console.log(`[ingest] Replaced ${deleted.length} prior snapshot row(s) for ${snapshotDate}`);
    }

    const [snapshot] = await sql<{ id: string }[]>`
      INSERT INTO asx_snapshots (snapshot_date, collected_at, source, stock_count, notes)
      VALUES (
        ${snapshotDate},
        ${collectedAt},
        ${SOURCE_LABEL},
        ${merged.length},
        ${`Generated by scripts/ingest-asx-snapshot.ts on ${new Date().toISOString()}`}
      )
      RETURNING id
    `;
    console.log(`[ingest] Snapshot row id = ${snapshot.id}`);

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
}

function writeReportFile(report: ReturnType<typeof buildReport>) {
  if (!existsSync(REPORT_DIR)) mkdirSync(REPORT_DIR, { recursive: true });
  const reportPath = join(REPORT_DIR, `ingest-${report.snapshot_date}.json`);
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
  console.log(`[ingest] Reconciliation report written to ${reportPath}`);
}

// ─── Main ──────────────────────────────────────────────────

async function main() {
  const args = new Set(process.argv.slice(2));
  const baseline = args.has("--baseline");

  // 1. Load + derive in memory
  console.log(`[ingest] Reading from ${IMPORT_DIR}`);
  const { snapshot, rows: merged } = loadSnapshot({ importDir: IMPORT_DIR, curationPath: CURATION_PATH });

  // 2. Build report (applies both presets)
  const report = buildReport(merged, snapshot.snapshot_date, snapshot.collected_at);
  printSummary(report);

  // 3. Validate against fixture (or baseline) BEFORE touching the DB
  validateOrBaseline(report, { baseline });

  // 4. Persist to DB
  await persist(merged, report.snapshot_date, report.collected_at);

  // 5. Audit-trail report
  writeReportFile(report);

  console.log(`\n✓ Ingest complete.`);
}

main().catch((err) => {
  console.error("\n✗ Ingest failed:", err);
  process.exit(2);
});
