/**
 * Deterministic intent-rule layer (plan §7a, layer 1).
 *
 * An ordered list of `{ pattern, build }` entries. The first pattern
 * that matches the (lowercased, trimmed) utterance wins. Order matters:
 * specific rules come before more general ones so e.g. "market cap of
 * more than 50m" matches the Q1 filter, not the generic stock-fact rule.
 *
 * Anything that doesn't match here goes through to `screen-matcher.ts`'s
 * constrained Anthropic classifier.
 */
import { STAGE_IDS } from "@/src/screen/funnel";
import type { Intent } from "@/src/screen/intent";
import type { CategoryId, FundId } from "@/src/screen/fund-qa";
import type { ProcessTopicId } from "@/src/screen/process-qa";

type Rule = {
  pattern: RegExp;
  /**
   * Most rules return a fixed Intent. Fund-info needs the text to
   * extract `fundId` + `category` from the same string the pattern
   * matched against. Returns null when the rule's pattern matched but
   * the deeper extraction failed (e.g. fund mentioned but nothing
   * useful otherwise) — caller continues to the next rule.
   */
  build: (text: string) => Intent | null;
};

// ─── Fund-info detection helpers ────────────────────────────────────
//
// Used by `matchFundInfoRule` further down. The rule only fires when a
// fund name is unambiguously present — partial matches (category alone)
// would clobber the screening dispatch (e.g. "what are the fees" mid-
// session has nothing to do with fund-info).
//
// Order matters: more specific names first so e.g. "premium small" beats
// "small companies" beats anything containing "small".

const FUND_PATTERNS: Array<[RegExp, FundId]> = [
  [
    /\b(?:oc[\s-]+)?premium[\s-]+small[\s-]+(?:companies|cos?)\b|\bpremium[\s-]+small\b/i,
    "premium_small",
  ],
  [/\b(?:oc[\s-]+)?small[\s-]+(?:companies|cos?)\b/i, "premium_small"],
  [/\b(?:oc[\s-]+)?micro[\s-]?cap\b/i, "micro_cap"],
  [/\b(?:oc[\s-]+)?mid[\s-]?cap\b/i, "mid_cap"],
];

// Specific patterns first so e.g. "performance fees" matches that
// category instead of falling through to the generic `performance` row.
const CATEGORY_PATTERNS: Array<[RegExp, CategoryId]> = [
  [/\bperformance\s+fees?\b|\bincentive\s+fees?\b/i, "performance_fees"],
  [/\bmanagement\s+fees?\b|\bannual\s+fees?\b|\bongoing\s+fees?\b|\bMER\b/i, "management_fees"],
  [/\btransaction\s+costs?\b|\bbuy[/\s-]?sell\b|\bspread\b|\bbrokerage\b/i, "transaction_costs"],
  [/\b(?:fees?|costs?|charges?)\b/i, "management_fees"],
  [
    /\bminimum\s+(?:investment|amount|balance)\b|\bsmallest\s+investment\b|\bhow\s+much.*\binvest\b|\bhow\s+much\s+do\s+i\s+need\b/i,
    "minimum_investment",
  ],
  [/\bdistributions?\b|\bpayouts?\b|\bincome\s+payment\b/i, "distributions"],
  [
    /\bwithdraw|\bredempt|\bexit\b|\bcash\s+out\b|\bsell\s+out\b|\btake\s+out\b/i,
    "withdrawals",
  ],
  [/\bcooling[\s-]?off\b|\bcancel.*invest|\bright\s+to\s+cancel\b/i, "cooling_off"],
  [/\babout\s+copia\b|\bresponsible\s+entity\b|\bcopia\s+investment\s+partners\b/i, "about_copia"],
  [
    /\babout\s+(?:OC|the\s+manager)\b|\bwho\s+(?:is\s+OC|manages|runs)\b|\binvestment\s+manager\b|\bteam\b|\bpeople\b/i,
    "about_oc",
  ],
  [
    /\bhow\s+(?:do\s+i|to|can\s+i)\s+(?:apply|invest|sign\s+up|start|join|buy)\b|\bapplication\s+process\b/i,
    "how_to_apply",
  ],
  [/\btax(?:es|ation)?\b|\bAMIT\b/i, "tax"],
  [/\bESG\b|\benvironmental.*social\b|\bethical\b|\bsustainabilit/i, "esg"],
  [/\bperformance\b|\breturns?\b|\bhow\s+(?:has|did|is)\s+.*perform/i, "performance"],
  [/\bobjective\b|\btarget\s+return\b|\baims?\s+to\b|\bgoal\b|\boutperform/i, "investment_objective"],
  [
    /\bstrateg(?:y|ies)\b|\bapproach\b|\bhow\s+(?:does|do)\s+.*(?:pick|select|choose|invest)\b|\bphilosophy\b|\bmethod\b/i,
    "investment_strategy",
  ],
  [
    /\b(?:investment\s+)?universe\b|\bwhat\s+(?:does|do).*invest\s+in\b|\bwhat\s+(?:companies|stocks?)\b/i,
    "investment_universe",
  ],
  [
    /\basset\s+allocation\b|\bportfolio\s+composition\b|\bhow\s+much\s+(?:in\s+)?cash\b|\bcash\s+(?:weighting|level)\b/i,
    "asset_allocation",
  ],
  [
    /\btime[\s-]?frame\b|\btime\s+horizon\b|\bhow\s+long\b|\binvestment\s+period\b|\bholding\s+period\b/i,
    "investment_timeframe",
  ],
  [/\brisks?(?:\s+level|\s+profile)?\b|\bhow\s+risky\b|\bvolatility\b/i, "risk_level"],
  [
    // `right for` only matches when followed by a fund-context noun
    // (me, us, whom, investors) OR when it sits at the end of the
    // utterance (e.g. "who is the small companies fund right for"). The
    // bare `right for` was loose enough to match "the price is right
    // for the market" — fine in fund context (gated by fund name in
    // matchFundInfoRule) but cleaner to constrain at the source.
    /\btarget\s+market\b|\bwho.*(?:suit|appropriate|suited\s+for)\b|\bright\s+for\s+(?:me|us|whom|investors?)\b|\bright\s+for\s*[.?!]?\s*$|\bwho\s+is\s+(?:it|this).*\s+for\b/i,
    "target_market",
  ],
  [
    /\b(?:tell\s+me\s+about|what\s+is|describe|details?\s+about|overview|about\s+the)\b/i,
    "fund_overview",
  ],
];

function extractFundId(text: string): FundId | null {
  for (const [re, id] of FUND_PATTERNS) if (re.test(text)) return id;
  return null;
}

function extractCategoryId(text: string): CategoryId | null {
  for (const [re, id] of CATEGORY_PATTERNS) if (re.test(text)) return id;
  return null;
}

/**
 * Fire `info_fund_field` only when a fund name is detected. Without an
 * explicit fund mention we can't disambiguate from screening-mode
 * questions like "what are the fees?". Defaults the category to
 * `fund_overview` when only the fund name appears (e.g. "tell me about
 * the OC mid-cap fund").
 */
function matchFundInfoRule(text: string): Intent | null {
  const fundId = extractFundId(text);
  if (!fundId) return null;
  const category = extractCategoryId(text) ?? "fund_overview";
  return { kind: "info_fund_field", fundId, category };
}

// ─── Process Q&A topic detection ────────────────────────────────────
//
// Used by `matchProcessInfoRule` further down. Unlike fund-info there's
// no name gate — a topic keyword alone fires the rule. The rule sits
// AFTER matchFundInfoRule so a fund-qualified utterance still wins
// (e.g. "what's the mid-cap fund's risk level" → info_fund_field, not
// info_process_field/risk_management). Order matters within the table:
// more specific patterns first.

const PROCESS_TOPIC_PATTERNS: Array<[RegExp, ProcessTopicId]> = [
  [
    /\b(?:investment\s+philosophy|investment\s+approach|investment\s+beliefs?|philosophy|beliefs?\s+about\s+invest)\b/i,
    "philosophy",
  ],
  [
    /\b(?:investment\s+style|style|active\s+vs\s+passive|growth\s+vs\s+value|tracking\s+error|benchmark[\s-]?unaware)\b/i,
    "style",
  ],
  [
    /\b(?:investable\s+universe|investment\s+universe|stock\s+universe|what\s+(?:does|do)\s+(?:they|oc)\s+invest\s+in)\b/i,
    "universe",
  ],
  [
    /\b(?:research\s+(?:process|effort|approach|method)|company\s+visits?|fundamental\s+research|how\s+(?:does|do).*\bresearch\b)\b/i,
    "research",
  ],
  [
    /\b(?:stock\s+selection|initial\s+screen|operational\s+risk\s+assessment|\bORA\b|valuation\s+(?:score|assessment|process)|how\s+(?:does|do).*\b(?:pick|select|choose)\s+stocks?)\b/i,
    "stock_selection",
  ],
  [
    /\b(?:portfolio\s+construction|weighting\s+matrix|stock\s+weight|position\s+sizing|cash\s+allocation|liquidity\s+scaling|construct(?:ing|s)?\s+portfolios?|build(?:ing|s)?\s+portfolios?)\b/i,
    "portfolio_construction",
  ],
  [
    /\b(?:risk\s+management|risk\s+committee|\bRMC\b|risk\s+controls?|sector\s+limits?|how\s+(?:does|do).*\bmanage\s+risk\b)\b/i,
    "risk_management",
  ],
  [
    /\b(?:ESG|environmental\s+social|UNPRI|responsible\s+invest|ethical\s+invest|sustainabilit)\b/i,
    "esg",
  ],
  [
    /\b(?:corporate\s+governance|voting\s+(?:policy|process|rights?)|proxy\s+voting|\bproxies\b|shareholder\s+rights?)\b/i,
    "corporate_governance",
  ],
  [
    /\b(?:transaction\s+costs?|brokerage|trading\s+costs?|broker\s+(?:rates?|panel)|execution\s+costs?)\b/i,
    "transaction_costs",
  ],
  [
    /\b(?:tax\s+management|after.?tax|franking|capital\s+gains\s+tax|\bCGT\b|tax\s+approach|tax\s+treatment)\b/i,
    "tax",
  ],
  [
    // Tightened away from the bare `\bthe\s+team\b` clause — that fired
    // on common English ("what does the team think about NXT?") and
    // hijacked stock-fact intents. Now requires either a name, a
    // role-specific noun, or "OC team" / "investment team" framing.
    /\b(?:investment\s+team|OC\s+team|OC's\s+team|head\s+of\s+(?:invest|equit)|robert\s+frost|bruce\s+loveday|stephen\s+evans|portfolio\s+manager|fund\s+manager|who\s+(?:runs|leads|manages)\s+(?:the\s+)?(?:funds?|portfolios?|invest))\b/i,
    "team",
  ],
];

function extractProcessTopic(text: string): ProcessTopicId | null {
  for (const [re, id] of PROCESS_TOPIC_PATTERNS) if (re.test(text)) return id;
  return null;
}

/**
 * Fire `info_process_field` when a process-topic keyword is detected.
 * Sits AFTER matchFundInfoRule so fund-qualified utterances still win.
 * Keywords are specific enough to avoid hijacking generic stock-fact
 * patterns (e.g. "market cap" stays a stock-fact intent).
 */
function matchProcessInfoRule(text: string): Intent | null {
  const topic = extractProcessTopic(text);
  if (!topic) return null;
  return { kind: "info_process_field", topic };
}

/**
 * Patterns are matched against the lowercased + trimmed utterance.
 * Most patterns omit `^` / `$` so they're substring-matched. Use the
 * `^` anchor where the rule should fire only at utterance start
 * (e.g. "next" alone vs "what's next?").
 */
const RULES: Rule[] = [
  // ─── Universal navigation (anchored short utterances) ───────────
  {
    pattern: /^(?:next|continue|keep\s+going|next\s+(?:step|filter)|move\s+on)\b[\s.!?]*$/,
    build: () => ({ kind: "next_step" }),
  },
  {
    pattern: /^(?:start\s+over|reset|restart)\b/,
    build: () => ({ kind: "restart" }),
  },

  // ─── Funnel filters (specific — must precede generic stock-fact) ─
  // Q1: market cap > $50m
  {
    pattern: /\bmarket\s+cap\b.*\b(?:>|over|above|more\s+than|greater\s+than|exceeding|of\s+more\s+than)\b.*\$?\s*50\s*m/,
    build: () => ({ kind: "apply_filter", filterId: STAGE_IDS.Q1_MCAP_50M }),
  },
  {
    pattern: /\b50\s+million\b.*\b(?:market\s+cap|capitalization)/,
    build: () => ({ kind: "apply_filter", filterId: STAGE_IDS.Q1_MCAP_50M }),
  },
  {
    pattern: /\b(?:market\s+cap|mcap|size)\s+(?:filter|check|test|screen)\b/,
    build: () => ({ kind: "apply_filter", filterId: STAGE_IDS.Q1_MCAP_50M }),
  },

  // Q2: exclude top 100 by mcap (OC is small/mid-cap — largest names
  // are out of scope). Triggers on "top 100" phrasing in either form
  // ("take out the top 100" or just "top 100" alone) since the only
  // Q2-related ask in the pitch is to remove them.
  {
    pattern: /\btop\s+(?:one\s+)?100\b/,
    build: () => ({ kind: "apply_filter", filterId: STAGE_IDS.Q2_EXCLUDE_TOP_100 }),
  },

  // Q3: turnover ≥ 20%
  {
    pattern: /\bturnover\b.*\b(?:>=?|over|above|of\s+at\s+least|at\s+least|≥)?\s*20\s*(?:%|percent)/,
    build: () => ({ kind: "apply_filter", filterId: STAGE_IDS.Q3_TURNOVER_20 }),
  },
  {
    pattern: /\b20\s*(?:%|percent)\b.*\bturnover/,
    build: () => ({ kind: "apply_filter", filterId: STAGE_IDS.Q3_TURNOVER_20 }),
  },
  {
    pattern: /\b(?:turnover|liquidity)\s+(?:filter|check|test|screen)\b/,
    build: () => ({ kind: "apply_filter", filterId: STAGE_IDS.Q3_TURNOVER_20 }),
  },

  // Q4: profitable. The "X filter" phrasings ("run the profitability
  // filter", "apply profitability") sit alongside the original Pep
  // brief wordings — and must precede the generic earnings_status
  // stock-fact rule in POST_FUND_INFO_RULES that also matches
  // "profitability".
  {
    pattern: /\b(?:remove|filter\s+out|exclude)\b.*\b(?:un|not\s+)?profitable\b/,
    build: () => ({ kind: "apply_filter", filterId: STAGE_IDS.Q4_PROFITABLE }),
  },
  {
    pattern: /\b(?:only|just)\s+profitable\b/,
    build: () => ({ kind: "apply_filter", filterId: STAGE_IDS.Q4_PROFITABLE }),
  },
  {
    pattern: /\bprofitable\s+(?:companies|stocks?|names?)\b/,
    build: () => ({ kind: "apply_filter", filterId: STAGE_IDS.Q4_PROFITABLE }),
  },
  {
    pattern: /\bprofitabilit(?:y|ies)\s+(?:filter|check|test|screen)\b/,
    build: () => ({ kind: "apply_filter", filterId: STAGE_IDS.Q4_PROFITABLE }),
  },
  {
    pattern: /\b(?:run|apply|do)\s+(?:the\s+)?profitabilit(?:y|ies)\b/,
    build: () => ({ kind: "apply_filter", filterId: STAGE_IDS.Q4_PROFITABLE }),
  },

  // Q5: unproven / complex tech
  {
    pattern: /\bunproven\b.*\btech/,
    build: () => ({ kind: "apply_filter", filterId: STAGE_IDS.Q5_UNPROVEN_TECH }),
  },
  {
    pattern: /\bcomplex\s+tech/,
    build: () => ({ kind: "apply_filter", filterId: STAGE_IDS.Q5_UNPROVEN_TECH }),
  },
  {
    pattern: /\b(?:tech|technology)\s+(?:filter|check|test|screen)\b/,
    build: () => ({ kind: "apply_filter", filterId: STAGE_IDS.Q5_UNPROVEN_TECH }),
  },

  // Q6: single commodity / single mine
  {
    pattern: /\bsingle[\s-]commodity\b/,
    build: () => ({ kind: "apply_filter", filterId: STAGE_IDS.Q6_SINGLE_COMMODITY }),
  },
  {
    pattern: /\bsingle[\s-]mine\b/,
    build: () => ({ kind: "apply_filter", filterId: STAGE_IDS.Q6_SINGLE_COMMODITY }),
  },
  {
    pattern: /\b(?:commodity|mine|miner|miners)\s+(?:filter|check|test|screen)\b/,
    build: () => ({ kind: "apply_filter", filterId: STAGE_IDS.Q6_SINGLE_COMMODITY }),
  },

  // ─── Daily monitoring (Q7) ──────────────────────────────────────
  {
    pattern: /\b(?:daily|every\s+(?:day|morning))\b.*\b(?:email|update|notif|alert|monitor|check|change)/,
    build: () => ({ kind: "monitoring_enable_daily" }),
  },
  {
    pattern: /\b(?:notify|alert)\s+me\b.*\b(?:change|update)/,
    build: () => ({ kind: "monitoring_enable_daily" }),
  },
  {
    pattern: /\b6\s*am\b/,
    build: () => ({ kind: "monitoring_enable_daily" }),
  },

  // ─── Portfolio overlap (Q8) ─────────────────────────────────────
  {
    pattern: /\b(?:my|our|current)\s+(?:portfolio|holdings?)\b.*\b(?:meet|match|still|criteria|screen)/,
    build: () => ({ kind: "info_portfolio_overlap" }),
  },
  {
    pattern: /\b(?:how\s+many|which)\b.*\b(?:portfolio|holdings?)\b.*\b(?:meet|still)/,
    build: () => ({ kind: "info_portfolio_overlap" }),
  },
];

/**
 * Rules that run AFTER the fund-info check. Generic patterns that
 * could otherwise swallow a fund-qualified utterance (e.g. the bare
 * "market cap" stock-fact rule shouldn't beat "OC mid-cap fund's
 * market cap" → info_fund_field).
 */
const POST_FUND_INFO_RULES: Rule[] = [
  // ─── Stock-fact (info_stock_field) ──────────────────────────────
  {
    pattern: /\b(?:share\s+price|trading\s+at|price\s+of|how\s+much\s+is)\b/,
    build: () => ({ kind: "info_stock_field", field: "share_price" }),
  },
  {
    pattern: /\b(?:market\s+cap(?:italization)?|mcap)\b/,
    build: () => ({ kind: "info_stock_field", field: "market_cap" }),
  },
  {
    pattern: /\b(?:is|are)\b.*\bprofitable\b/,
    build: () => ({ kind: "info_stock_field", field: "earnings_status" }),
  },
  {
    pattern: /\b(?:earnings|earning|making\s+money|profitability)\b/,
    build: () => ({ kind: "info_stock_field", field: "earnings_status" }),
  },

  // ─── Output prefs ───────────────────────────────────────────────
  // Pep's funnel-complete prompt offers "say the word" for email — so
  // the broader bare-email phrasings ("email please", "email me",
  // even just "email") are intentionally caught here.
  //
  // These sit BEFORE the generic stock lookup ("details of X") because
  // utterances like "email me the details of the list" otherwise get
  // hijacked by the `details? of` clause and routed to info_stock_field.
  // Workflow actions (email/show) are more specific than the catch-all
  // browse pattern, so they should win when both could match.
  {
    pattern: /\bemail\b.*\b(?:list|stocks?|results?|me|it|details?)\b/,
    build: () => ({ kind: "output_email" }),
  },
  {
    pattern: /\bsend\s+(?:me|it)\b.*\b(?:email|by\s+email|inbox)/,
    build: () => ({ kind: "output_email" }),
  },
  {
    pattern: /\bsend\s+me\b.*\b(?:list|stocks?|results?|the\s+list|details?)\b/,
    build: () => ({ kind: "output_email" }),
  },
  {
    // Bare email-intent — "email please", "send the email", "email me",
    // or just "email" alone. Anchored to email/mail at sentence start
    // OR after a sender verb so we don't fire on "send me the list".
    pattern: /^\s*(?:email|mail)\b|\bemail\s+(?:please|the\s+list|me\s+please)\b|\bsend\s+(?:me\s+)?(?:the\s+)?email\b/,
    build: () => ({ kind: "output_email" }),
  },
  {
    pattern: /\b(?:show|display)\b.*\b(?:list|stocks?|results?|me|it|to\s+me)\b/,
    build: () => ({ kind: "output_show" }),
  },
  {
    pattern: /^(?:just\s+)?show\s+me\b[\s.!?]*$/,
    build: () => ({ kind: "output_show" }),
  },

  // Generic stock lookup — "tell me about X", "info on X", "what about
  // X". No `field` so the dispatcher renders the full snapshot panel.
  // Sits AFTER the field-specific stock-fact rules AND the output-pref
  // workflow rules above, so e.g. "tell me about BHP's market cap"
  // routes to market_cap and "email me the details of the list"
  // routes to output_email rather than info_stock_field. Unresolved
  // names fall through to describeStockFactUnresolved().
  {
    pattern: /\b(?:tell\s+me\s+(?:more\s+)?about|info\s+(?:on|about)|details?\s+(?:on|about|of)|what\s+about)\b/,
    build: () => ({ kind: "info_stock_field" }),
  },
];

/** Run a rule list, returning the first built Intent. */
function runRules(text: string, rules: readonly Rule[]): Intent | null {
  for (const rule of rules) {
    if (!rule.pattern.test(text)) continue;
    const built = rule.build(text);
    if (built) return built;
  }
  return null;
}

/**
 * Try to match an utterance against the rule layer. Returns null if no
 * rule matches; the caller should fall back to the constrained classifier.
 *
 * Order: navigation/funnel/Q7/Q8 rules first, then fund-info (only
 * fires when a fund name is present), then process-info (fires on
 * process-topic keywords without a name gate), then the generic
 * stock-fact + output catch-alls. The two info matchers sit between
 * the two halves so e.g. "OC mid-cap fund's market cap" routes to
 * fund-info, "OC's research process" routes to process-info, and
 * "market cap above 50m" still hits the Q1 funnel rule.
 */
export function matchIntentRule(utterance: string): Intent | null {
  const text = utterance.toLowerCase().trim();
  if (text.length === 0) return null;
  return (
    runRules(text, RULES) ??
    matchFundInfoRule(text) ??
    matchProcessInfoRule(text) ??
    runRules(text, POST_FUND_INFO_RULES)
  );
}
