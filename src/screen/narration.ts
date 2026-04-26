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

/**
 * Narration for the starting universe stage — the unfiltered ASX
 * universe that the funnel begins from. Fires after the intro so the
 * audience hears the count grounded against the spoken framing.
 */
export function describeUniverseStage(count: number): string {
  return `We're starting from the full ASX universe — about ${count.toLocaleString()} listed companies in this snapshot.`;
}

/**
 * Spoken introduction for the Questionnaire (Pep's 8 Qs) preset.
 * Source: docs/plans/OC_Prem_Dyn_-_FSC_Questionnaire_0625.txt §1.2 +
 * §2.2 + §2.7 — OC's investment philosophy and the FSC-questionnaire-
 * style criteria. Spoken once per session per preset, doubles as the
 * session greeting (no separate opener fires before this).
 */
export function describeQuestionnaireIntro(): string {
  return `Hi, I'm Pep. Let me tell you about the OC Funds Management stock filtering approach. OC is a benchmark-unaware Australian equities manager — they take a stock-specific, bottom-up approach and assess each company on its own merits, not its index weight. The methodology I'll walk you through filters out a few categories of company by design: those that are too small, unprofitable, too speculative, or insufficiently liquid. I'll apply each criterion one at a time so you can see how the universe narrows.`;
}

/**
 * Spoken introduction for the OC methodology preset.
 * Source: docs/plans/OC_Prem_Dyn_-_FSC_Questionnaire_0625.txt §2.9
 * (Initial Screen) + §2.7 (universe exclusions). Spoken once per
 * session per preset, doubles as the session greeting (no separate
 * opener fires before this).
 */
export function describeMethodologyIntro(): string {
  return `Hi, I'm Pep. Let me tell you about the OC Funds Management stock filtering approach. OC's investable universe is defined by an initial screen that removes companies they consider unsuitable — too small, not profitable or cash-flow positive, single-commodity miners, complex or unproven technology, illiquid names, and the ASX 100 since OC is a small-cap manager. What's left is the starting point for the OC Premium Small Companies Fund. I'll walk you through that screen step by step — click Next to move through each filter.`;
}

/**
 * Brief transition spoken when the user toggles to the OC methodology
 * mid-session (after running the questionnaire). Skips the full intro
 * — the audience has already heard the philosophy framing — and just
 * cues the comparison.
 */
export function describeMethodologyTransition(): string {
  return `Now let's compare the full OC Funds stock filtering process.`;
}

/**
 * Brief transition spoken when the user toggles back to the
 * questionnaire mid-session.
 */
export function describeQuestionnaireTransition(): string {
  return `Back to the questionnaire walk-through. Click Next to step through it.`;
}

/** Narration when the funnel is already complete and `next_step` is asked. */
export function describeFunnelComplete(): string {
  return `The funnel is already complete. Try Reset to start over.`;
}

/**
 * Narration for an `info_fund_field` intent that resolved to a specific
 * answer in `data/fund-qa.json`. The category label is dropped from the
 * spoken line — the answer is self-contained — but the fund name is
 * prepended so the listener has context.
 */
export function describeFundFact(fundDisplayName: string, answer: string): string {
  return `${fundDisplayName}: ${answer}`;
}

/** Narration when `info_fund_field` couldn't resolve a fund (e.g. user only said "what are the fees?" without naming a fund). */
export function describeFundFactMissingFund(): string {
  return `Which fund did you mean — Mid-Cap, Micro-Cap, or Premium Small Companies?`;
}

/** Narration when `info_fund_field` resolved a fund but no recognised category. */
export function describeFundFactMissingCategory(fundDisplayName: string): string {
  return `What would you like to know about ${fundDisplayName}? You can ask about the strategy, fees, minimum investment, distributions, or other details.`;
}
