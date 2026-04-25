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

interface FundCase {
  utterance: string;
  fundId: string;
  category: string;
}

const fundCases: FundCase[] = [
  // ─── Fund-only (defaults to fund_overview) ─────────────
  { utterance: "Tell me about the OC mid-cap fund", fundId: "mid_cap", category: "fund_overview" },
  { utterance: "What is the OC micro-cap fund", fundId: "micro_cap", category: "fund_overview" },
  { utterance: "Tell me about Premium Small Companies", fundId: "premium_small", category: "fund_overview" },

  // ─── Fund + specific category ──────────────────────────
  { utterance: "What are the mid-cap fund's fees", fundId: "mid_cap", category: "management_fees" },
  { utterance: "What's the performance fee on the micro-cap fund", fundId: "micro_cap", category: "performance_fees" },
  { utterance: "What's the buy-sell spread on the OC mid-cap fund", fundId: "mid_cap", category: "transaction_costs" },
  { utterance: "What's the minimum investment for the micro-cap", fundId: "micro_cap", category: "minimum_investment" },
  { utterance: "How do I invest in the small companies fund", fundId: "premium_small", category: "how_to_apply" },
  { utterance: "What's the strategy of the OC mid-cap fund", fundId: "mid_cap", category: "investment_strategy" },
  { utterance: "What's the objective of the micro-cap fund", fundId: "micro_cap", category: "investment_objective" },
  { utterance: "How risky is the mid-cap fund", fundId: "mid_cap", category: "risk_level" },
  { utterance: "Who is the small companies fund right for", fundId: "premium_small", category: "target_market" },
  { utterance: "How are distributions paid in the mid-cap fund", fundId: "mid_cap", category: "distributions" },
  { utterance: "How do I withdraw from the micro-cap fund", fundId: "micro_cap", category: "withdrawals" },
  { utterance: "What's the cooling-off period for the small companies fund", fundId: "premium_small", category: "cooling_off" },
  { utterance: "What's the tax treatment of the mid-cap fund", fundId: "mid_cap", category: "tax" },
  { utterance: "How has the small companies fund performed", fundId: "premium_small", category: "performance" },
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

  describe("info_fund_field — multi-fund Q&A", () => {
    for (const c of fundCases) {
      it(`classifies "${c.utterance}" → ${c.fundId}/${c.category}`, () => {
        const intent = matchIntentRule(c.utterance);
        expect(intent).not.toBeNull();
        expect(intent!.kind).toBe("info_fund_field");
        const ff = intent as { fundId?: string; category?: string };
        expect(ff.fundId).toBe(c.fundId);
        expect(ff.category).toBe(c.category);
      });
    }

    it("does NOT fire fund-info when no fund name is present (avoids screening-mode collision)", () => {
      // "what are the fees" mid-screening should NOT route to fund-info
      // — without a fund name, we can't disambiguate.
      const intent = matchIntentRule("what are the fees");
      // Either matches a screening intent or returns null; in NEITHER case
      // should it be info_fund_field.
      expect(intent?.kind).not.toBe("info_fund_field");
    });

    it("specific filter rules still win over fund-info when both could match", () => {
      // "market cap above 50m" should hit Q1, not fund-info, because the
      // funnel rules run first.
      const intent = matchIntentRule("market cap above 50m");
      expect(intent?.kind).toBe("apply_filter");
    });
  });
});
