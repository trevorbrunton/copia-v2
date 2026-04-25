/**
 * Tests for the client-side ScreenState reducer (src/screen/state.ts).
 *
 * Uses a small synthetic row set so the assertions are easy to read and
 * the test runs in milliseconds. The big-snapshot integration is covered
 * by `filters.test.ts`.
 */
import { describe, expect, it } from "vitest";

import {
  STAGE_IDS,
  type FilterableSecurity,
} from "@/src/screen/funnel";
import {
  applyFilterToState,
  initScreenState,
  resetScreenState,
  type Snapshot,
} from "@/src/screen/state";

const SNAPSHOT: Snapshot = {
  id: null,
  date: "2026-04-24",
  collectedAt: "2026-04-24T00:00:00Z",
};

/** Hand-crafted row set chosen so each filter has both passes and fails. */
function makeRows(): FilterableSecurity[] {
  return [
    // BIG: large mcap, profitable, cash-flow positive, asx100, not flagged
    {
      ticker: "BIG",
      market_cap_snapshot: 100_000_000_000,
      turnover_ratio_ttm: 0.5,
      is_profitable: true,
      is_cashflow_positive: true,
      is_asx_100: true,
      is_unproven_or_complex_tech: false,
      is_single_commodity_or_single_mine: false,
    },
    // MID: passes everything, mid-cap, not asx100
    {
      ticker: "MID",
      market_cap_snapshot: 5_000_000_000,
      turnover_ratio_ttm: 0.3,
      is_profitable: true,
      is_cashflow_positive: true,
      is_asx_100: false,
      is_unproven_or_complex_tech: false,
      is_single_commodity_or_single_mine: false,
    },
    // ILL: liquid enough mcap but turnover < 20%
    {
      ticker: "ILL",
      market_cap_snapshot: 2_000_000_000,
      turnover_ratio_ttm: 0.05,
      is_profitable: true,
      is_cashflow_positive: true,
      is_asx_100: false,
      is_unproven_or_complex_tech: false,
      is_single_commodity_or_single_mine: false,
    },
    // LOSS: profitable=false
    {
      ticker: "LOSS",
      market_cap_snapshot: 1_500_000_000,
      turnover_ratio_ttm: 0.4,
      is_profitable: false,
      is_cashflow_positive: false,
      is_asx_100: false,
      is_unproven_or_complex_tech: false,
      is_single_commodity_or_single_mine: false,
    },
    // SCM: single-commodity flagged
    {
      ticker: "SCM",
      market_cap_snapshot: 1_000_000_000,
      turnover_ratio_ttm: 0.6,
      is_profitable: true,
      is_cashflow_positive: true,
      is_asx_100: false,
      is_unproven_or_complex_tech: false,
      is_single_commodity_or_single_mine: true,
    },
    // TINY: below mcap threshold
    {
      ticker: "TINY",
      market_cap_snapshot: 30_000_000,
      turnover_ratio_ttm: 0.4,
      is_profitable: true,
      is_cashflow_positive: true,
      is_asx_100: false,
      is_unproven_or_complex_tech: false,
      is_single_commodity_or_single_mine: false,
    },
    // NULL: no enrichment data
    {
      ticker: "NULL",
      market_cap_snapshot: null,
      turnover_ratio_ttm: null,
      is_profitable: null,
      is_cashflow_positive: null,
      is_asx_100: false,
      is_unproven_or_complex_tech: false,
      is_single_commodity_or_single_mine: false,
    },
  ];
}

describe("initScreenState", () => {
  it("seeds the universe stage with all rows", () => {
    const rows = makeRows();
    const state = initScreenState(SNAPSHOT, rows);
    expect(state.stages).toHaveLength(1);
    expect(state.current.id).toBe(STAGE_IDS.UNIVERSE);
    expect(state.current.count).toBe(rows.length);
    expect(state.current.tickers).toEqual(rows.map((r) => r.ticker));
    expect(state.snapshot).toBe(SNAPSHOT);
  });
});

describe("applyFilterToState", () => {
  const rows = makeRows();

  it("appends a new stage and updates `current`", () => {
    const s0 = initScreenState(SNAPSHOT, rows);
    const s1 = applyFilterToState(s0, "q1_mcap_50m", rows);
    expect(s1.stages).toHaveLength(2);
    expect(s1.current.id).toBe(STAGE_IDS.Q1_MCAP_50M);
    expect(s1.current).toBe(s1.stages[s1.stages.length - 1]);
  });

  it("Q1 (mcap > 50m) drops TINY and NULL", () => {
    const s0 = initScreenState(SNAPSHOT, rows);
    const s1 = applyFilterToState(s0, "q1_mcap_50m", rows);
    expect(new Set(s1.current.tickers)).toEqual(new Set(["BIG", "MID", "ILL", "LOSS", "SCM"]));
  });

  it("Q3 (turnover ≥ 20%) drops ILL", () => {
    let s = initScreenState(SNAPSHOT, rows);
    s = applyFilterToState(s, "q1_mcap_50m", rows);
    s = applyFilterToState(s, "q3_turnover_20", rows);
    expect(new Set(s.current.tickers)).toEqual(new Set(["BIG", "MID", "LOSS", "SCM"]));
  });

  it("Q4 (profitable) drops LOSS, leaving only true profitables", () => {
    let s = initScreenState(SNAPSHOT, rows);
    s = applyFilterToState(s, "q1_mcap_50m", rows);
    s = applyFilterToState(s, "q3_turnover_20", rows);
    s = applyFilterToState(s, "q4_profitable", rows);
    expect(new Set(s.current.tickers)).toEqual(new Set(["BIG", "MID", "SCM"]));
  });

  it("Q6 (single commodity) drops SCM", () => {
    let s = initScreenState(SNAPSHOT, rows);
    s = applyFilterToState(s, "q1_mcap_50m", rows);
    s = applyFilterToState(s, "q3_turnover_20", rows);
    s = applyFilterToState(s, "q4_profitable", rows);
    s = applyFilterToState(s, "q5_unproven_tech", rows);
    s = applyFilterToState(s, "q6_single_commodity", rows);
    expect(new Set(s.current.tickers)).toEqual(new Set(["BIG", "MID"]));
  });

  it("M7 (exclude ASX 100) drops BIG", () => {
    let s = initScreenState(SNAPSHOT, rows);
    s = applyFilterToState(s, "m1_mcap_50m", rows);
    s = applyFilterToState(s, "m2_profitable", rows);
    s = applyFilterToState(s, "m3_cashflow_positive", rows);
    s = applyFilterToState(s, "m4_exclude_unproven_tech", rows);
    s = applyFilterToState(s, "m5_exclude_single_commodity", rows);
    s = applyFilterToState(s, "m6_sufficient_liquidity", rows);
    s = applyFilterToState(s, "m7_exclude_asx_100", rows);
    expect(new Set(s.current.tickers)).toEqual(new Set(["MID"]));
  });

  it("Q2 (top 100) preserves order by mcap desc and caps at 100", () => {
    const big = Array.from({ length: 150 }, (_, i): FilterableSecurity => ({
      ticker: `T${String(i).padStart(3, "0")}`,
      market_cap_snapshot: 1_000_000_000 - i,
      turnover_ratio_ttm: 0.5,
      is_profitable: true,
      is_cashflow_positive: true,
      is_asx_100: false,
      is_unproven_or_complex_tech: false,
      is_single_commodity_or_single_mine: false,
    }));
    const s0 = initScreenState(SNAPSHOT, big);
    const s1 = applyFilterToState(s0, "q2_top_100", big);
    expect(s1.current.count).toBe(100);
    expect(s1.current.tickers[0]).toBe("T000");
    expect(s1.current.tickers[99]).toBe("T099");
  });

  it("treats `current.tickers` as the input set (composability)", () => {
    // After Q1 the universe should be irrelevant; Q3 only sees Q1's output.
    const s0 = initScreenState(SNAPSHOT, rows);
    const s1 = applyFilterToState(s0, "q1_mcap_50m", rows);
    const s2 = applyFilterToState(s1, "q3_turnover_20", rows);
    // TINY should not reappear at any later stage
    for (const stage of s2.stages.slice(1)) {
      expect(stage.tickers).not.toContain("TINY");
    }
  });

  it("does not mutate the previous state", () => {
    const s0 = initScreenState(SNAPSHOT, rows);
    const stagesBefore = s0.stages;
    const currentBefore = s0.current;
    applyFilterToState(s0, "q1_mcap_50m", rows);
    expect(s0.stages).toBe(stagesBefore);
    expect(s0.current).toBe(currentBefore);
    expect(s0.stages).toHaveLength(1);
  });

  it("handles an empty `current.tickers` set without crashing", () => {
    // Synthetic state where the previous stage filtered everything out.
    const s0 = initScreenState(SNAPSHOT, rows);
    let s = applyFilterToState(s0, "q1_mcap_50m", rows);
    // Pretend an upstream filter produced an empty current stage.
    s = { ...s, current: { ...s.current, tickers: [], count: 0 } };
    const next = applyFilterToState(s, "q3_turnover_20", rows);
    expect(next.current.count).toBe(0);
    expect(next.current.tickers).toEqual([]);
    expect(next.stages.at(-1)).toBe(next.current);
  });

  it("each new Stage has an ISO-8601 appliedAt timestamp", () => {
    const s = applyFilterToState(initScreenState(SNAPSHOT, rows), "q1_mcap_50m", rows);
    expect(s.current.appliedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    // Each stage should have its own timestamp.
    expect(s.stages[0].appliedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});

describe("resetScreenState", () => {
  it("returns to a fresh universe stage with the same snapshot", () => {
    const rows = makeRows();
    let s = initScreenState(SNAPSHOT, rows);
    s = applyFilterToState(s, "q1_mcap_50m", rows);
    s = applyFilterToState(s, "q3_turnover_20", rows);
    expect(s.stages).toHaveLength(3);

    const reset = resetScreenState(s, rows);
    expect(reset.stages).toHaveLength(1);
    expect(reset.current.id).toBe(STAGE_IDS.UNIVERSE);
    expect(reset.current.count).toBe(rows.length);
    expect(reset.snapshot).toBe(s.snapshot);
  });
});
