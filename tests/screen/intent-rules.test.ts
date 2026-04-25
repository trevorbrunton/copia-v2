/**
 * Deterministic intent-rule tests. The rule layer must classify the
 * scripted-pitch happy paths without an LLM call. Paraphrases that
 * miss the rules go through to the classifier fallback (separately
 * tested).
 */
import { describe, expect, it } from "vitest";
import { matchIntentRule } from "@/src/screen/intent-rules";

const cases: Array<{ utterance: string; expectKind: string; expectFilter?: string; expectField?: string }> = [
  // ─── Universal navigation ──────────────────────────────
  { utterance: "next", expectKind: "next_step" },
  { utterance: "Next.", expectKind: "next_step" },
  { utterance: "Continue", expectKind: "next_step" },
  { utterance: "Keep going", expectKind: "next_step" },
  { utterance: "Next step", expectKind: "next_step" },
  { utterance: "Move on", expectKind: "next_step" },
  { utterance: "Start over", expectKind: "restart" },
  { utterance: "Reset.", expectKind: "restart" },
  { utterance: "Restart please", expectKind: "restart" },

  // ─── OC initial screen shortcut ────────────────────────
  { utterance: "Run the OC initial screen", expectKind: "apply_initial_screen" },
  { utterance: "run the initial screen", expectKind: "apply_initial_screen" },
  { utterance: "Run the screen", expectKind: "apply_initial_screen" },

  // ─── Output preferences ────────────────────────────────
  { utterance: "Show me the list", expectKind: "output_show" },
  { utterance: "Just show me", expectKind: "output_show" },
  { utterance: "Display the stocks", expectKind: "output_show" },
  { utterance: "Email me the list", expectKind: "output_email" },
  { utterance: "Send me the list", expectKind: "output_email" },
  { utterance: "Email it to me", expectKind: "output_email" },

  // ─── Daily monitoring (Q7) ─────────────────────────────
  { utterance: "Send me a daily email on changes to this screen", expectKind: "monitoring_enable_daily" },
  { utterance: "Daily updates please", expectKind: "monitoring_enable_daily" },
  { utterance: "Notify me of changes", expectKind: "monitoring_enable_daily" },
  { utterance: "Email me every morning at 6am", expectKind: "monitoring_enable_daily" },

  // ─── Portfolio overlap (Q8) ────────────────────────────
  { utterance: "How many of my holdings still meet the criteria", expectKind: "info_portfolio_overlap" },
  { utterance: "Which of my portfolio meets the screen", expectKind: "info_portfolio_overlap" },
  { utterance: "How many companies in the current portfolio still meet", expectKind: "info_portfolio_overlap" },

  // ─── Funnel filters (Questionnaire path) ───────────────
  { utterance: "Show me ASX stocks with a market cap of more than 50 million dollars", expectKind: "apply_filter", expectFilter: "q1_mcap_50m" },
  { utterance: "Stocks with market cap above $50m", expectKind: "apply_filter", expectFilter: "q1_mcap_50m" },
  { utterance: "Take the top 100 by market cap", expectKind: "apply_filter", expectFilter: "q2_top_100" },
  { utterance: "Top 100", expectKind: "apply_filter", expectFilter: "q2_top_100" },
  { utterance: "Filter to stocks with annual turnover of at least 20%", expectKind: "apply_filter", expectFilter: "q3_turnover_20" },
  { utterance: "Turnover above 20 percent", expectKind: "apply_filter", expectFilter: "q3_turnover_20" },
  { utterance: "Remove unprofitable companies", expectKind: "apply_filter", expectFilter: "q4_profitable" },
  { utterance: "Show only profitable stocks", expectKind: "apply_filter", expectFilter: "q4_profitable" },
  { utterance: "Filter out unproven technology", expectKind: "apply_filter", expectFilter: "q5_unproven_tech" },
  { utterance: "Remove complex tech stocks", expectKind: "apply_filter", expectFilter: "q5_unproven_tech" },
  { utterance: "Filter out single-commodity stocks", expectKind: "apply_filter", expectFilter: "q6_single_commodity" },
  { utterance: "Remove single mine stocks", expectKind: "apply_filter", expectFilter: "q6_single_commodity" },

  // ─── Stock-fact (info_stock_field) ─────────────────────
  { utterance: "What's BHP's market cap?", expectKind: "info_stock_field", expectField: "market_cap" },
  { utterance: "What's the market cap of CBA?", expectKind: "info_stock_field", expectField: "market_cap" },
  { utterance: "What's the share price of RIO?", expectKind: "info_stock_field", expectField: "share_price" },
  { utterance: "How much is BHP trading at?", expectKind: "info_stock_field", expectField: "share_price" },
  { utterance: "Is CBA profitable?", expectKind: "info_stock_field", expectField: "earnings_status" },
  { utterance: "What are BHP's earnings?", expectKind: "info_stock_field", expectField: "earnings_status" },
];

describe("matchIntentRule", () => {
  for (const c of cases) {
    it(`classifies "${c.utterance}" → ${c.expectKind}${c.expectFilter ? ` (${c.expectFilter})` : ""}${c.expectField ? ` (${c.expectField})` : ""}`, () => {
      const intent = matchIntentRule(c.utterance);
      expect(intent).not.toBeNull();
      expect(intent!.kind).toBe(c.expectKind);
      if (c.expectFilter) {
        expect((intent as { filterId: string }).filterId).toBe(c.expectFilter);
      }
      if (c.expectField) {
        expect((intent as { field: string }).field).toBe(c.expectField);
      }
    });
  }

  it("returns null for utterances with no rule match (classifier fallback path)", () => {
    expect(matchIntentRule("Tell me about the weather")).toBeNull();
    expect(matchIntentRule("What time is it?")).toBeNull();
    expect(matchIntentRule("")).toBeNull();
    expect(matchIntentRule("    ")).toBeNull();
  });

  it("is case-insensitive", () => {
    expect(matchIntentRule("NEXT")?.kind).toBe("next_step");
    expect(matchIntentRule("RUN THE INITIAL SCREEN")?.kind).toBe("apply_initial_screen");
  });
});
