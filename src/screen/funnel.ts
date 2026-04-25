/**
 * Pep avatar v2 — funnel filter engine.
 *
 * Pure functions over rows that satisfy `FilterableSecurity`. Both the
 * ingest script (in-memory `MergedRow`) and the future API route (Drizzle
 * `AsxSecurity`) consume these via the shared interface.
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
};

// ─── Filter helpers ───────────────────────────────────────────

/**
 * Profitability and cash-flow filters use a strict-true comparison.
 * Rows where `is_profitable === null` (i.e. we have no income data) are
 * **dropped** — we cannot assert profitability we did not measure.
 * Same applies to `is_cashflow_positive`.
 */
function pushStage(
  acc: Stage[],
  rows: FilterableSecurity[],
  id: StageId
): FilterableSecurity[] {
  acc.push({
    id,
    label: STAGE_LABELS[id],
    count: rows.length,
    tickers: rows.map((r) => r.ticker),
  });
  return rows;
}

// ─── Presets ──────────────────────────────────────────────────

/**
 * Questionnaire preset — answers Pep's eight supplied demo questions.
 * 6 filter stages plus the `universe` baseline.
 *
 * Null-handling: stage 4 (profitable) drops rows where `is_profitable`
 * is null (no enrichment data). Stage 5 (unproven_tech) is currently a
 * no-op for v2 — the curated flag list is empty — but the stage is
 * still emitted so the funnel rail visibly advances.
 */
export function applyQuestionnairePreset(rows: FilterableSecurity[]): Stage[] {
  const stages: Stage[] = [];
  let current = pushStage(stages, rows, STAGE_IDS.UNIVERSE);

  // Q1: market cap > $50m
  current = pushStage(
    stages,
    current.filter(
      (r) =>
        r.market_cap_snapshot !== null &&
        r.market_cap_snapshot > FILTER_THRESHOLDS.MCAP_MIN_AUD
    ),
    STAGE_IDS.Q1_MCAP_50M
  );

  // Q2: top 100 by market cap
  current = pushStage(
    stages,
    [...current]
      .sort((a, b) => (b.market_cap_snapshot ?? 0) - (a.market_cap_snapshot ?? 0))
      .slice(0, FILTER_THRESHOLDS.TOP_N_BY_MCAP),
    STAGE_IDS.Q2_TOP_100
  );

  // Q3: turnover ≥ 20%
  current = pushStage(
    stages,
    current.filter(
      (r) =>
        r.turnover_ratio_ttm !== null &&
        r.turnover_ratio_ttm >= FILTER_THRESHOLDS.TURNOVER_LIQUIDITY
    ),
    STAGE_IDS.Q3_TURNOVER_20
  );

  // Q4: profitable (drops nulls — see function-level note)
  current = pushStage(
    stages,
    current.filter((r) => r.is_profitable === true),
    STAGE_IDS.Q4_PROFITABLE
  );

  // Q5: unproven_tech (no-op when curated list is empty; stage still emitted)
  current = pushStage(
    stages,
    current.filter((r) => !r.is_unproven_or_complex_tech),
    STAGE_IDS.Q5_UNPROVEN_TECH
  );

  // Q6: single_commodity
  current = pushStage(
    stages,
    current.filter((r) => !r.is_single_commodity_or_single_mine),
    STAGE_IDS.Q6_SINGLE_COMMODITY
  );

  return stages;
}

/**
 * Methodology preset — answers "run the OC initial screen" per the FSC
 * questionnaire's stated process. 7 filter stages plus universe.
 *
 * Null-handling: stages M2 / M3 drop rows where the corresponding flag
 * is null (no enrichment data) — we cannot claim profitability or
 * cash-flow positivity we didn't measure.
 */
export function applyMethodologyPreset(rows: FilterableSecurity[]): Stage[] {
  const stages: Stage[] = [];
  let current = pushStage(stages, rows, STAGE_IDS.UNIVERSE);

  // M1: mcap > $50m
  current = pushStage(
    stages,
    current.filter(
      (r) =>
        r.market_cap_snapshot !== null &&
        r.market_cap_snapshot > FILTER_THRESHOLDS.MCAP_MIN_AUD
    ),
    STAGE_IDS.M1_MCAP_50M
  );

  // M2: profitable
  current = pushStage(
    stages,
    current.filter((r) => r.is_profitable === true),
    STAGE_IDS.M2_PROFITABLE
  );

  // M3: cash-flow positive
  current = pushStage(
    stages,
    current.filter((r) => r.is_cashflow_positive === true),
    STAGE_IDS.M3_CASHFLOW_POSITIVE
  );

  // M4: exclude unproven tech
  current = pushStage(
    stages,
    current.filter((r) => !r.is_unproven_or_complex_tech),
    STAGE_IDS.M4_EXCLUDE_UNPROVEN_TECH
  );

  // M5: exclude single commodity
  current = pushStage(
    stages,
    current.filter((r) => !r.is_single_commodity_or_single_mine),
    STAGE_IDS.M5_EXCLUDE_SINGLE_COMMODITY
  );

  // M6: sufficient liquidity (same proxy as Questionnaire — §12 #1)
  current = pushStage(
    stages,
    current.filter(
      (r) =>
        r.turnover_ratio_ttm !== null &&
        r.turnover_ratio_ttm >= FILTER_THRESHOLDS.TURNOVER_LIQUIDITY
    ),
    STAGE_IDS.M6_SUFFICIENT_LIQUIDITY
  );

  // M7: exclude ASX 100
  current = pushStage(
    stages,
    current.filter((r) => !r.is_asx_100),
    STAGE_IDS.M7_EXCLUDE_ASX_100
  );

  return stages;
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
