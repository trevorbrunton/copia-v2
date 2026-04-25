/**
 * Pep avatar v2 — funnel filter engine.
 *
 * Pure functions over rows that satisfy `FilterableSecurity`. Both the
 * ingest script (in-memory `MergedRow`) and the API route (Drizzle-loaded
 * rows) consume these via the shared interface.
 *
 * See `docs/plans/pep-avatar-v2-plan.md` §4b for the canonical filter
 * sequences.
 */

// ─── Filter thresholds (locked by §4 / §12 of the plan) ────────

export const FILTER_THRESHOLDS = {
  /** Minimum market cap (AUD) for stage 1 of both presets. */
  MCAP_MIN_AUD: 50_000_000,
  /** Minimum TTM turnover ratio used as the liquidity proxy. §12 #1. */
  TURNOVER_LIQUIDITY: 0.20,
  /** "Top 100 by mcap" — used by Questionnaire stage 2 and the `is_asx_100` derivation. */
  TOP_N_BY_MCAP: 100,
} as const;

// ─── Stage IDs ─────────────────────────────────────────────────

export const STAGE_IDS = {
  UNIVERSE: "universe",
  Q1_MCAP_50M: "q1_mcap_50m",
  Q2_TOP_100: "q2_top_100",
  Q3_TURNOVER_20: "q3_turnover_20",
  Q4_PROFITABLE: "q4_profitable",
  Q5_UNPROVEN_TECH: "q5_unproven_tech",
  Q6_SINGLE_COMMODITY: "q6_single_commodity",
  M1_MCAP_50M: "m1_mcap_50m",
  M2_PROFITABLE: "m2_profitable",
  M3_CASHFLOW_POSITIVE: "m3_cashflow_positive",
  M4_EXCLUDE_UNPROVEN_TECH: "m4_exclude_unproven_tech",
  M5_EXCLUDE_SINGLE_COMMODITY: "m5_exclude_single_commodity",
  M6_SUFFICIENT_LIQUIDITY: "m6_sufficient_liquidity",
  M7_EXCLUDE_ASX_100: "m7_exclude_asx_100",
} as const;

export type StageId = (typeof STAGE_IDS)[keyof typeof STAGE_IDS];

export const STAGE_LABELS: Record<StageId, string> = {
  universe: "Universe",
  q1_mcap_50m: "Market cap > $50m",
  q2_top_100: "Top 100 by market cap",
  q3_turnover_20: "Turnover ≥ 20%",
  q4_profitable: "Profitable (TTM)",
  q5_unproven_tech: "Exclude unproven / complex tech",
  q6_single_commodity: "Exclude single commodity / single mine",
  m1_mcap_50m: "Market cap > $50m",
  m2_profitable: "Profitable (TTM)",
  m3_cashflow_positive: "Cash-flow positive (TTM)",
  m4_exclude_unproven_tech: "Exclude unproven / complex tech",
  m5_exclude_single_commodity: "Exclude single commodity / single mine",
  m6_sufficient_liquidity: "Sufficient liquidity",
  m7_exclude_asx_100: "Exclude ASX 100",
};

// ─── Row shape consumed by the filter engine ──────────────────

/**
 * Minimal row shape required to apply funnel filters. Both the ingest
 * script's `MergedRow` (pre-DB) and Drizzle's `AsxSecurity` (post-DB)
 * structurally satisfy this interface so the same filter code runs in
 * both contexts.
 */
export interface FilterableSecurity {
  ticker: string;
  market_cap_snapshot: number | null;
  turnover_ratio_ttm: number | null;
  is_profitable: boolean | null;
  is_cashflow_positive: boolean | null;
  is_asx_100: boolean;
  is_unproven_or_complex_tech: boolean;
  is_single_commodity_or_single_mine: boolean;
}

export type Stage = {
  id: StageId;
  label: string;
  count: number;
  tickers: string[];
  /** ISO-8601 timestamp at which this stage was constructed. */
  appliedAt: string;
};

// ─── Per-filter step (single source of truth for each rule) ───

export type FilterId = Exclude<StageId, "universe">;

const STAGE_TO_FILTER_ID: Record<StageId, FilterId | null> = {
  universe: null,
  q1_mcap_50m: "q1_mcap_50m",
  q2_top_100: "q2_top_100",
  q3_turnover_20: "q3_turnover_20",
  q4_profitable: "q4_profitable",
  q5_unproven_tech: "q5_unproven_tech",
  q6_single_commodity: "q6_single_commodity",
  m1_mcap_50m: "m1_mcap_50m",
  m2_profitable: "m2_profitable",
  m3_cashflow_positive: "m3_cashflow_positive",
  m4_exclude_unproven_tech: "m4_exclude_unproven_tech",
  m5_exclude_single_commodity: "m5_exclude_single_commodity",
  m6_sufficient_liquidity: "m6_sufficient_liquidity",
  m7_exclude_asx_100: "m7_exclude_asx_100",
};

export function isFilterId(id: string): id is FilterId {
  return id in STAGE_TO_FILTER_ID && STAGE_TO_FILTER_ID[id as StageId] !== null;
}

/**
 * Apply a single filter to a row set. **Single source of truth** for
 * each rule — the preset functions below compose this; the API route
 * calls it directly. The Top-100 filter is special-cased because it's
 * a sort-and-take, not a row-level predicate.
 *
 * Null-handling: profitability and cash-flow filters use a strict-true
 * comparison. Rows with null are dropped because we cannot assert a
 * fact we did not measure.
 */
export function applyOneFilter(
  rows: FilterableSecurity[],
  filterId: FilterId
): FilterableSecurity[] {
  switch (filterId) {
    case STAGE_IDS.Q1_MCAP_50M:
    case STAGE_IDS.M1_MCAP_50M:
      return rows.filter(
        (r) => r.market_cap_snapshot !== null && r.market_cap_snapshot > FILTER_THRESHOLDS.MCAP_MIN_AUD
      );
    case STAGE_IDS.Q2_TOP_100:
      return [...rows]
        .sort((a, b) => (b.market_cap_snapshot ?? 0) - (a.market_cap_snapshot ?? 0))
        .slice(0, FILTER_THRESHOLDS.TOP_N_BY_MCAP);
    case STAGE_IDS.Q3_TURNOVER_20:
    case STAGE_IDS.M6_SUFFICIENT_LIQUIDITY:
      return rows.filter(
        (r) => r.turnover_ratio_ttm !== null && r.turnover_ratio_ttm >= FILTER_THRESHOLDS.TURNOVER_LIQUIDITY
      );
    case STAGE_IDS.Q4_PROFITABLE:
    case STAGE_IDS.M2_PROFITABLE:
      return rows.filter((r) => r.is_profitable === true);
    case STAGE_IDS.M3_CASHFLOW_POSITIVE:
      return rows.filter((r) => r.is_cashflow_positive === true);
    case STAGE_IDS.Q5_UNPROVEN_TECH:
    case STAGE_IDS.M4_EXCLUDE_UNPROVEN_TECH:
      return rows.filter((r) => !r.is_unproven_or_complex_tech);
    case STAGE_IDS.Q6_SINGLE_COMMODITY:
    case STAGE_IDS.M5_EXCLUDE_SINGLE_COMMODITY:
      return rows.filter((r) => !r.is_single_commodity_or_single_mine);
    case STAGE_IDS.M7_EXCLUDE_ASX_100:
      return rows.filter((r) => !r.is_asx_100);
  }
}

// ─── Stage construction ───────────────────────────────────────

/**
 * Build a `Stage` from a row set. `appliedAt` defaults to "now"; tests
 * that need deterministic timestamps can pass an explicit value.
 */
export function makeStage(
  id: StageId,
  rows: FilterableSecurity[],
  appliedAt: string = new Date().toISOString()
): Stage {
  return {
    id,
    label: STAGE_LABELS[id],
    count: rows.length,
    tickers: rows.map((r) => r.ticker),
    appliedAt,
  };
}

// ─── Presets ──────────────────────────────────────────────────

const QUESTIONNAIRE_FILTERS: FilterId[] = [
  STAGE_IDS.Q1_MCAP_50M,
  STAGE_IDS.Q2_TOP_100,
  STAGE_IDS.Q3_TURNOVER_20,
  STAGE_IDS.Q4_PROFITABLE,
  STAGE_IDS.Q5_UNPROVEN_TECH,
  STAGE_IDS.Q6_SINGLE_COMMODITY,
];

const METHODOLOGY_FILTERS: FilterId[] = [
  STAGE_IDS.M1_MCAP_50M,
  STAGE_IDS.M2_PROFITABLE,
  STAGE_IDS.M3_CASHFLOW_POSITIVE,
  STAGE_IDS.M4_EXCLUDE_UNPROVEN_TECH,
  STAGE_IDS.M5_EXCLUDE_SINGLE_COMMODITY,
  STAGE_IDS.M6_SUFFICIENT_LIQUIDITY,
  STAGE_IDS.M7_EXCLUDE_ASX_100,
];

function applyPreset(rows: FilterableSecurity[], filters: FilterId[]): Stage[] {
  const stages: Stage[] = [makeStage(STAGE_IDS.UNIVERSE, rows)];
  let current = rows;
  for (const f of filters) {
    current = applyOneFilter(current, f);
    stages.push(makeStage(f, current));
  }
  return stages;
}

/**
 * Questionnaire preset — answers Pep's eight supplied demo questions.
 * 6 filter stages plus the `universe` baseline.
 *
 * Q5 (unproven_tech) is currently a no-op for v2 — the curated flag
 * list is empty — but the stage is still emitted so the funnel rail
 * visibly advances.
 */
export function applyQuestionnairePreset(rows: FilterableSecurity[]): Stage[] {
  return applyPreset(rows, QUESTIONNAIRE_FILTERS);
}

/**
 * Methodology preset — answers "run the OC initial screen" per the FSC
 * questionnaire's stated process. 7 filter stages plus universe.
 */
export function applyMethodologyPreset(rows: FilterableSecurity[]): Stage[] {
  return applyPreset(rows, METHODOLOGY_FILTERS);
}

// ─── Snapshot-level derivation ────────────────────────────────

/**
 * Compute the set of tickers in the snapshot's top-N by market cap.
 * Used to seed `is_asx_100` at ingest time. NULL market caps are
 * excluded from ranking.
 */
export function topNByMcapTickers(
  rows: FilterableSecurity[],
  n: number = FILTER_THRESHOLDS.TOP_N_BY_MCAP
): Set<string> {
  return new Set(
    [...rows]
      .filter((r) => r.market_cap_snapshot !== null)
      .sort((a, b) => (b.market_cap_snapshot ?? 0) - (a.market_cap_snapshot ?? 0))
      .slice(0, n)
      .map((r) => r.ticker)
  );
}
