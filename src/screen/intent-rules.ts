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

type Rule = {
  pattern: RegExp;
  build: () => Intent;
};

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

  // ─── OC initial screen shortcut ─────────────────────────────────
  {
    pattern: /\b(?:run|apply|do)\s+(?:the\s+)?(?:oc\s+)?(?:initial\s+)?screen\b/,
    build: () => ({ kind: "apply_initial_screen" }),
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

  // Q2: top 100 by mcap
  {
    pattern: /\btop\s+(?:one\s+)?100\b/,
    build: () => ({ kind: "apply_filter", filterId: STAGE_IDS.Q2_TOP_100 }),
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

  // Q4: profitable
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

  // Q5: unproven / complex tech
  {
    pattern: /\bunproven\b.*\btech/,
    build: () => ({ kind: "apply_filter", filterId: STAGE_IDS.Q5_UNPROVEN_TECH }),
  },
  {
    pattern: /\bcomplex\s+tech/,
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

  // ─── Stock-fact (info_stock_field) — runs after the funnel rules ─
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

  // ─── Output prefs (catch-all) ───────────────────────────────────
  {
    pattern: /\bemail\b.*\b(?:list|stocks?|results?|me|it)\b/,
    build: () => ({ kind: "output_email" }),
  },
  {
    pattern: /\bsend\s+(?:me|it)\b.*\b(?:email|by\s+email|inbox)/,
    build: () => ({ kind: "output_email" }),
  },
  {
    pattern: /\bsend\s+me\b.*\b(?:list|stocks?|results?|the\s+list)\b/,
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
];

/**
 * Try to match an utterance against the rule layer. Returns null if no
 * rule matches; the caller should fall back to the constrained classifier.
 */
export function matchIntentRule(utterance: string): Intent | null {
  const text = utterance.toLowerCase().trim();
  if (text.length === 0) return null;
  for (const rule of RULES) {
    if (rule.pattern.test(text)) return rule.build();
  }
  return null;
}
