/**
 * Filter engine tests for the v2 demo.
 *
 * Loads the actual ASX snapshot from `data/asx/*.json` (no DB), applies
 * each preset's full filter sequence, and asserts the per-stage counts
 * exactly match `tests/screen/expected-preset-counts.json`. Re-baselining
 * is intentional and should be done via `bun scripts/ingest-asx-snapshot.ts --baseline`.
 *
 * Plus invariant checks (monotonic counts, ticker subsets) that catch
 * filter-engine bugs the per-stage count check would miss.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

import {
  applyMethodologyPreset,
  applyQuestionnairePreset,
  STAGE_IDS,
} from "@/src/screen/funnel";
import { loadSnapshot } from "@/src/screen/load-snapshot";

const IMPORT_DIR = resolve("data/asx");
const CURATION_PATH = resolve("data/curation.json");
const FIXTURE_PATH = resolve("tests/screen/expected-preset-counts.json");

type FixtureStage = { stage: string; count: number };
type Fixture = {
  questionnaire_preset: FixtureStage[];
  methodology_preset: FixtureStage[];
};

function readFixture(): Fixture {
  return JSON.parse(readFileSync(FIXTURE_PATH, "utf-8")) as Fixture;
}

const { rows } = loadSnapshot({ importDir: IMPORT_DIR, curationPath: CURATION_PATH });
const fixture = readFixture();

describe("Questionnaire preset", () => {
  const stages = applyQuestionnairePreset(rows);

  it("produces the expected stage IDs in order", () => {
    expect(stages.map((s) => s.id)).toEqual([
      STAGE_IDS.UNIVERSE,
      STAGE_IDS.Q1_MCAP_50M,
      STAGE_IDS.Q2_EXCLUDE_TOP_100,
      STAGE_IDS.Q3_TURNOVER_20,
      STAGE_IDS.Q4_PROFITABLE,
      STAGE_IDS.Q5_UNPROVEN_TECH,
      STAGE_IDS.Q6_SINGLE_COMMODITY,
    ]);
  });

  it("matches the fixture per-stage counts exactly", () => {
    const actual = stages.map((s) => ({ stage: s.id, count: s.count }));
    expect(actual).toEqual(fixture.questionnaire_preset);
  });

  it("counts are monotonically non-increasing across stages", () => {
    for (let i = 1; i < stages.length; i++) {
      expect(stages[i].count).toBeLessThanOrEqual(stages[i - 1].count);
    }
  });

  it("each stage's tickers are a subset of the previous stage", () => {
    for (let i = 1; i < stages.length; i++) {
      const prev = new Set(stages[i - 1].tickers);
      for (const t of stages[i].tickers) {
        expect(prev.has(t)).toBe(true);
      }
    }
  });

  it("Q5 (unproven tech) leaves the count unchanged on this snapshot — no curated tickers tagged", () => {
    const q4 = stages.find((s) => s.id === STAGE_IDS.Q4_PROFITABLE)!;
    const q5 = stages.find((s) => s.id === STAGE_IDS.Q5_UNPROVEN_TECH)!;
    expect(q5.count).toBe(q4.count);
  });

  it("Q6 (single commodity) removes exactly the curated tickers present after Q5", () => {
    const q5 = stages.find((s) => s.id === STAGE_IDS.Q5_UNPROVEN_TECH)!;
    const q6 = stages.find((s) => s.id === STAGE_IDS.Q6_SINGLE_COMMODITY)!;
    const q5Set = new Set(q5.tickers);
    const q6Set = new Set(q6.tickers);
    const removed = q5.tickers.filter((t) => !q6Set.has(t));
    // Every removed ticker must be flagged single-commodity
    for (const t of removed) {
      const row = rows.find((r) => r.ticker === t)!;
      expect(row.is_single_commodity_or_single_mine).toBe(true);
    }
    // No retained ticker should be flagged single-commodity
    for (const t of q6.tickers) {
      const row = rows.find((r) => r.ticker === t)!;
      expect(row.is_single_commodity_or_single_mine).toBe(false);
      expect(q5Set.has(t)).toBe(true);
    }
  });
});

describe("Methodology preset", () => {
  const stages = applyMethodologyPreset(rows);

  it("produces the expected stage IDs in order", () => {
    expect(stages.map((s) => s.id)).toEqual([
      STAGE_IDS.UNIVERSE,
      STAGE_IDS.M1_MCAP_50M,
      STAGE_IDS.M2_PROFITABLE,
      STAGE_IDS.M3_CASHFLOW_POSITIVE,
      STAGE_IDS.M4_EXCLUDE_UNPROVEN_TECH,
      STAGE_IDS.M5_EXCLUDE_SINGLE_COMMODITY,
      STAGE_IDS.M6_SUFFICIENT_LIQUIDITY,
      STAGE_IDS.M7_EXCLUDE_ASX_100,
    ]);
  });

  it("matches the fixture per-stage counts exactly", () => {
    const actual = stages.map((s) => ({ stage: s.id, count: s.count }));
    expect(actual).toEqual(fixture.methodology_preset);
  });

  it("counts are monotonically non-increasing across stages", () => {
    for (let i = 1; i < stages.length; i++) {
      expect(stages[i].count).toBeLessThanOrEqual(stages[i - 1].count);
    }
  });

  it("each stage's tickers are a subset of the previous stage", () => {
    for (let i = 1; i < stages.length; i++) {
      const prev = new Set(stages[i - 1].tickers);
      for (const t of stages[i].tickers) {
        expect(prev.has(t)).toBe(true);
      }
    }
  });

  it("M2 (profitable) drops every row where is_profitable !== true", () => {
    const m1 = stages.find((s) => s.id === STAGE_IDS.M1_MCAP_50M)!;
    const m2 = stages.find((s) => s.id === STAGE_IDS.M2_PROFITABLE)!;
    const m1Set = new Set(m1.tickers);
    const m2Set = new Set(m2.tickers);
    for (const t of m1.tickers) {
      const row = rows.find((r) => r.ticker === t)!;
      const inM2 = m2Set.has(t);
      expect(inM2).toBe(row.is_profitable === true);
      if (inM2) expect(m1Set.has(t)).toBe(true);
    }
  });

  it("M7 (exclude ASX 100) removes only is_asx_100=true rows", () => {
    const m6 = stages.find((s) => s.id === STAGE_IDS.M6_SUFFICIENT_LIQUIDITY)!;
    const m7 = stages.find((s) => s.id === STAGE_IDS.M7_EXCLUDE_ASX_100)!;
    const m7Set = new Set(m7.tickers);
    for (const t of m6.tickers) {
      const row = rows.find((r) => r.ticker === t)!;
      const retained = m7Set.has(t);
      expect(retained).toBe(!row.is_asx_100);
    }
  });
});

describe("Snapshot loader invariants", () => {
  it("every row has a non-empty ticker and company name", () => {
    for (const r of rows) {
      expect(r.ticker.length).toBeGreaterThan(0);
      expect(r.company_name.length).toBeGreaterThan(0);
    }
  });

  it("data_quality.enrichment_status agrees with the underlying field nulls", () => {
    for (const r of rows) {
      const present = [r.market_cap_snapshot, r.turnover_ratio_ttm, r.net_income_ttm].filter(
        (v) => v !== null
      ).length;
      if (r.data_quality.enrichment_status === "ok") expect(present).toBe(3);
      if (r.data_quality.enrichment_status === "failed") expect(present).toBe(0);
      if (r.data_quality.enrichment_status === "partial") {
        expect(present).toBeGreaterThan(0);
        expect(present).toBeLessThan(3);
      }
    }
  });

  it("is_asx_100 is true for exactly 100 tickers", () => {
    expect(rows.filter((r) => r.is_asx_100).length).toBe(100);
  });

  it("derived flags are consistent with the underlying numeric values", () => {
    for (const r of rows) {
      if (r.net_income_ttm === null) {
        expect(r.is_profitable).toBeNull();
        expect(r.earnings_status_snapshot).toBe("Insufficient data");
      } else {
        expect(r.is_profitable).toBe(r.net_income_ttm > 0);
      }
      if (r.free_cash_flow_ttm === null) {
        expect(r.is_cashflow_positive).toBeNull();
      } else {
        expect(r.is_cashflow_positive).toBe(r.free_cash_flow_ttm > 0);
      }
    }
  });
});
