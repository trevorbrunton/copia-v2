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

  // ─── Output preferences ────────────────────────────────
  { utterance: "Show me the list", expectKind: "output_show" },
  { utterance: "Just show me", expectKind: "output_show" },
  { utterance: "Display the stocks", expectKind: "output_show" },
  { utterance: "Email me the list", expectKind: "output_email" },
  { utterance: "Send me the list", expectKind: "output_email" },
  { utterance: "Email it to me", expectKind: "output_email" },
  { utterance: "Email please", expectKind: "output_email" },
  { utterance: "email", expectKind: "output_email" },
  { utterance: "Send me an email", expectKind: "output_email" },

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
  { utterance: "Take out the top 100 by market cap", expectKind: "apply_filter", expectFilter: "q2_exclude_top_100" },
  { utterance: "Top 100", expectKind: "apply_filter", expectFilter: "q2_exclude_top_100" },
  { utterance: "Filter to stocks with annual turnover of at least 20%", expectKind: "apply_filter", expectFilter: "q3_turnover_20" },
  { utterance: "Turnover above 20 percent", expectKind: "apply_filter", expectFilter: "q3_turnover_20" },
  { utterance: "Remove unprofitable companies", expectKind: "apply_filter", expectFilter: "q4_profitable" },
  { utterance: "Show only profitable stocks", expectKind: "apply_filter", expectFilter: "q4_profitable" },
  { utterance: "Run the profitability filter", expectKind: "apply_filter", expectFilter: "q4_profitable" },
  { utterance: "Apply profitability", expectKind: "apply_filter", expectFilter: "q4_profitable" },
  { utterance: "Profitability check", expectKind: "apply_filter", expectFilter: "q4_profitable" },
  { utterance: "Run the market cap filter", expectKind: "apply_filter", expectFilter: "q1_mcap_50m" },
  { utterance: "Run the turnover filter", expectKind: "apply_filter", expectFilter: "q3_turnover_20" },
  { utterance: "Run the tech filter", expectKind: "apply_filter", expectFilter: "q5_unproven_tech" },
  { utterance: "Run the commodity filter", expectKind: "apply_filter", expectFilter: "q6_single_commodity" },
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

  // ─── Generic stock lookup (no field; entity-resolver fills ticker) ─
  // The rule fires regardless of whether the name resolves — the
  // /process route runs the entity resolver after classification, and
  // the dispatcher falls back to describeStockFactUnresolved() when the
  // ticker stays undefined.
  { utterance: "Tell me about National Bank", expectKind: "info_stock_field" },
  { utterance: "Tell me about BHP", expectKind: "info_stock_field" },
  { utterance: "What about CBA", expectKind: "info_stock_field" },
  { utterance: "Info on RIO", expectKind: "info_stock_field" },
  { utterance: "Details about Westpac", expectKind: "info_stock_field" },
  { utterance: "Tell me more about Mineral Resources", expectKind: "info_stock_field" },
];

interface FundCase {
  utterance: string;
  fundId: string;
  category: string;
}

interface ProcessCase {
  utterance: string;
  topic: string;
}

const processCases: ProcessCase[] = [
  // ─── Process topic detection (no fund-name gate) ──────
  { utterance: "What is OC's investment philosophy", topic: "philosophy" },
  { utterance: "Tell me about OC's investment style", topic: "style" },
  { utterance: "What's the investable universe", topic: "universe" },
  { utterance: "Describe their research process", topic: "research" },
  { utterance: "How do they pick stocks", topic: "stock_selection" },
  { utterance: "Tell me about the Operational Risk Assessment", topic: "stock_selection" },
  { utterance: "How does OC construct portfolios", topic: "portfolio_construction" },
  { utterance: "What's the portfolio construction approach", topic: "portfolio_construction" },
  { utterance: "How do they manage risk", topic: "risk_management" },
  { utterance: "Tell me about the Risk Management Committee", topic: "risk_management" },
  { utterance: "What's the ESG policy", topic: "esg" },
  { utterance: "Describe their corporate governance approach", topic: "corporate_governance" },
  { utterance: "How do they vote proxies", topic: "corporate_governance" },
  { utterance: "How do they manage transaction costs", topic: "transaction_costs" },
  { utterance: "What's OC's tax management approach", topic: "tax" },
  { utterance: "Who runs the funds", topic: "team" },
  { utterance: "Tell me about Robert Frost", topic: "team" },
];

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
    expect(matchIntentRule("What time is it?")).toBeNull();
    expect(matchIntentRule("")).toBeNull();
    expect(matchIntentRule("    ")).toBeNull();
  });

  it("specific stock-fact field rules win over the generic 'tell me about' lookup", () => {
    // "tell me about BHP's market cap" should resolve to market_cap, not
    // the generic info_stock_field with no field — the field-specific
    // patterns sit before the generic lookup in POST_FUND_INFO_RULES.
    const intent = matchIntentRule("tell me about BHP's market cap");
    expect(intent?.kind).toBe("info_stock_field");
    expect((intent as { field?: string }).field).toBe("market_cap");
  });

  it("fund-info still wins over the generic stock lookup when a fund is named", () => {
    // "Tell me about the OC mid-cap fund" must route to info_fund_field,
    // not info_stock_field — matchFundInfoRule runs before the generic
    // lookup pattern.
    const intent = matchIntentRule("Tell me about the OC mid-cap fund");
    expect(intent?.kind).toBe("info_fund_field");
  });

  it("is case-insensitive", () => {
    expect(matchIntentRule("NEXT")?.kind).toBe("next_step");
    expect(matchIntentRule("RESET")?.kind).toBe("restart");
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

  describe("info_process_field — OC investment process Q&A", () => {
    for (const c of processCases) {
      it(`classifies "${c.utterance}" → ${c.topic}`, () => {
        const intent = matchIntentRule(c.utterance);
        expect(intent).not.toBeNull();
        expect(intent!.kind).toBe("info_process_field");
        expect((intent as { topic?: string }).topic).toBe(c.topic);
      });
    }

    it("fund-info wins over process-info when a fund is named", () => {
      // "what's the OC mid-cap fund's tax treatment" must route to
      // info_fund_field/tax, not info_process_field/tax — fund-info
      // runs before process-info in matchIntentRule.
      const intent = matchIntentRule("what's the OC mid-cap fund's tax treatment");
      expect(intent?.kind).toBe("info_fund_field");
      expect((intent as { category?: string }).category).toBe("tax");
    });

    it("specific filter rules still win over process-info when both could match", () => {
      // "market cap above 50m" should hit Q1, not get derailed by
      // process-info — funnel rules run first.
      const intent = matchIntentRule("market cap above 50m");
      expect(intent?.kind).toBe("apply_filter");
    });

    it("does NOT fire process-info on generic stock-fact terms", () => {
      // "what's the share price of CBA" must stay info_stock_field,
      // not get caught by a process-topic keyword.
      const intent = matchIntentRule("what's the share price of CBA");
      expect(intent?.kind).toBe("info_stock_field");
    });
  });
});
