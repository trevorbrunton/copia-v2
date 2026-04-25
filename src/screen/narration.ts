/**
 * Spoken-answer templates per plan §7c.
 *
 * Every utterance the avatar speaks goes through one of these
 * builders. They encode Pep's framing — including the curated-flag
 * caveats that D7 / §7c require — so the avatar never overstates
 * what the data shows.
 */
import type { FilterId, Stage } from "@/src/screen/funnel";

/** Compile-time exhaustiveness guard. Throws if a new FilterId was added without a case. */
function assertNever(x: never): never {
  throw new Error(`describeAppliedFilter: unhandled FilterId ${String(x)}`);
}

/**
 * Narration for a successfully-applied filter. `count` is the number
 * of stocks remaining after the filter; `prevCount` is what was there
 * before (used to phrase Q5's "no change" outcome).
 *
 * Adding a new `FilterId` without a case here will fail to typecheck
 * via `assertNever` — the compile-time guard makes the narration
 * surface the canonical error rather than silently returning
 * `undefined` to the transcript.
 */
export function describeAppliedFilter(filterId: FilterId, count: number, prevCount: number): string {
  const c = count.toLocaleString();
  switch (filterId) {
    case "q1_mcap_50m":
    case "m1_mcap_50m":
      return `${c} stocks on the ASX have a market cap above $50 million.`;
    case "q2_top_100":
      return `Here are the top ${c} by market cap.`;
    case "q3_turnover_20":
    case "m6_sufficient_liquidity":
      return `${c} of those have an annual turnover ratio of 20% or more.`;
    case "q4_profitable":
    case "m2_profitable":
      return `${c} are profitable on a TTM basis.`;
    case "m3_cashflow_positive":
      return `${c} are also free-cash-flow positive on a TTM basis.`;
    case "q5_unproven_tech":
    case "m4_exclude_unproven_tech":
      // Pep's subsumption framing per D7 / §17.
      return prevCount === count
        ? `Every stock with unproven or complex technology in this snapshot has already been excluded by the profitability filter — that's a curated demo flag, not an automatic classification. ${c} stocks remain.`
        : `${c} stocks remain after excluding unproven / complex tech — based on a curated demo flag.`;
    case "q6_single_commodity":
    case "m5_exclude_single_commodity":
      return `${c} stocks remain after excluding single-commodity / single-mine names — based on a curated reference list.`;
    case "m7_exclude_asx_100":
      return `${c} stocks remain after excluding the ASX 100 names. This is the OC initial screen.`;
    default:
      return assertNever(filterId);
  }
}

/** Narration when a stage's filter fails. */
export function describeAppliedFilterFailure(filterId: FilterId, error: string): string {
  return `Couldn't apply ${filterId.replace(/_/g, " ")}: ${error}.`;
}

/** Narration for `output_show`. */
export function describeOutputShow(currentStage: Stage): string {
  return `Showing all ${currentStage.count.toLocaleString()} stocks for ${currentStage.label} in the table.`;
}

/** Narration for `output_email`. Honest about the demo nature. */
export function describeOutputEmail(): string {
  return `I've queued the email — note this is a demo workflow, no email actually leaves the system.`;
}

/** Narration for `monitoring_enable_daily`. Honest about the demo nature. */
export function describeMonitoringEnabled(): string {
  return `Daily monitoring on. In production I'd email you at 6am every day, change-or-no-change. This is a demo workflow — no real schedule is started.`;
}

/** Narration for `info_stock_field` with a resolved ticker. */
export function describeStockFactRequest(ticker: string, field: string | undefined, snapshotDate: string | undefined): string {
  const fieldText = field ? field.replace(/_/g, " ") : "details";
  const sourceText = snapshotDate ? ` from our snapshot of ${snapshotDate}` : "";
  return `Looking up the ${fieldText} for ${ticker}${sourceText} — see the panel below.`;
}

/** Narration for `info_stock_field` with an unresolved ticker. */
export function describeStockFactUnresolved(): string {
  return `I couldn't pin down which company you meant. Try a ticker like BHP or a more specific company name.`;
}

/** Narration for Q8 portfolio overlap with results. */
export function describePortfolioOverlap(args: {
  matching: number;
  totalHoldings: number;
  nonMatchingTickers: string[];
  isSample: boolean;
}): string {
  const sampleNote = args.isSample ? " (based on your sample portfolio)" : "";
  const list = args.nonMatchingTickers.join(", ") || "none";
  return `${args.matching} of your ${args.totalHoldings} top holdings still meet the screen${sampleNote}. The ${args.nonMatchingTickers.length} that don't: ${list}.`;
}

/** Narration for `restart`. */
export function describeRestart(): string {
  return `Funnel reset. We're back to the universe stage.`;
}

/** Narration for `fallback`. */
export function describeFallback(): string {
  return `I can't answer that in this demo. Try asking about a filter, a stock's price or market cap, or running the OC initial screen.`;
}

/** Narration for `apply_initial_screen` (announces the run). */
export function describeInitialScreenStart(): string {
  return `Running the OC initial screen — applying market cap above $50m, profitable, cash-flow positive, the curated exclusions, liquidity, and the ASX 100 cut.`;
}

/** Narration when the funnel is already complete and `next_step` is asked. */
export function describeFunnelComplete(): string {
  return `The funnel is already complete. Try Reset to start over.`;
}
