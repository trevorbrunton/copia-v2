import { z } from "zod";

// ─── Response categories ────────────────────────────────────
export const responseCategories = [
  "greeting",
  "fund_manager",
  "investment_strategy",
  "since_inception_return",
  "recent_performance",
  "benchmark_comparison",
  "fund_overview",
  "fund_details",
  "fees",
  "minimum_investment",
  "how_to_invest",
  "distributions",
  "investment_universe",
  "portfolio_holdings",
  "why_mid_caps",
  "risk_management",
  "about_oc",
  "team_overview",
  "nga_lucas",
  "ratings",
  "esg",
  "other_funds",
  "copia",
  "mlc_mandate",
  "withdrawal",
  "cooling_off",
  "tax",
  "contact",
  "active_vs_passive",
  "fallback",
] as const;

export type ResponseCategory = (typeof responseCategories)[number];

// ─── Zod Schemas ────────────────────────────────────────────

export const demoResponseSchema = z.object({
  id: z.string().uuid(),
  category: z.enum(responseCategories),
  label: z.string().min(1),
  answerText: z.string().min(1),
  audioUrl: z.string().url().nullable(),
  sortOrder: z.number().int(),
  createdAt: z.date().nullable(),
  updatedAt: z.date().nullable(),
});

export const demoQuestionPatternSchema = z.object({
  id: z.string().uuid(),
  responseId: z.string().uuid(),
  pattern: z.string().min(1),
  isCanonical: z.number().int().min(0).max(1),
  createdAt: z.date().nullable(),
});

// ─── API response shape ─────────────────────────────────────

export const demoResponseWithPatternsSchema = demoResponseSchema.extend({
  patterns: z.array(demoQuestionPatternSchema.pick({
    id: true,
    pattern: true,
    isCanonical: true,
  })),
});

export type DemoResponseWithPatterns = z.infer<typeof demoResponseWithPatternsSchema>;

// ─── Classification result ──────────────────────────────────

export const classificationResultSchema = z.object({
  category: z.enum(responseCategories),
  confidence: z.number().min(0).max(1),
  matchedPattern: z.string().nullable(),
});

export type ClassificationResult = z.infer<typeof classificationResultSchema>;
