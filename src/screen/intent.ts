/**
 * Intent vocabulary for the v2 screen demo.
 *
 * Plan §7a defines two layers:
 *   1. Deterministic rule layer (intent-rules.ts) — fast, predictable
 *      for the scripted 8 questions and stock-fact queries.
 *   2. Constrained-classifier fallback (screen-matcher.ts) — Anthropic
 *      Haiku invoked only when no rule matches; output Zod-parsed
 *      against the same enum.
 *
 * `info_stock_field` carries an optional `field` hint extracted from the
 * rule (price / market cap / earnings status). Entity resolution
 * happens **after** intent classification when `info_stock_field` is
 * matched (entity-resolver.ts).
 */
import type { FilterId } from "@/src/screen/funnel";

export type StockFactField = "share_price" | "market_cap" | "earnings_status";

export type Intent =
  /** Apply a specific named filter from either preset. */
  | { kind: "apply_filter"; filterId: FilterId }
  /** Advance to the next filter in the active preset (handled client-side). */
  | { kind: "next_step" }
  /** Run the OC initial screen — applies the methodology preset end-to-end. */
  | { kind: "apply_initial_screen" }
  /** "Show me the list" — render the current shortlist in the table. */
  | { kind: "output_show" }
  /** "Email it to me" — mocked toast confirmation, no real email (D9). */
  | { kind: "output_email" }
  /** "What's BHP's market cap?" — entity resolved separately, ticker may be undefined. */
  | { kind: "info_stock_field"; ticker?: string; field?: StockFactField }
  /** Q8 — overlap of the OC sample portfolio with the current shortlist. */
  | { kind: "info_portfolio_overlap" }
  /** Q7 — toggle the daily-monitoring mock workflow. */
  | { kind: "monitoring_enable_daily" }
  /** Reset the funnel back to universe. */
  | { kind: "restart" }
  /** Out-of-scope or ambiguous; the avatar offers a polite refusal. */
  | { kind: "fallback" };

export type IntentKind = Intent["kind"];

export const INTENT_KINDS: readonly IntentKind[] = [
  "apply_filter",
  "next_step",
  "apply_initial_screen",
  "output_show",
  "output_email",
  "info_stock_field",
  "info_portfolio_overlap",
  "monitoring_enable_daily",
  "restart",
  "fallback",
] as const;
