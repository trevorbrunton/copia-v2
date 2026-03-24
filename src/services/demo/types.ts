import { z } from "zod";

// ─── Response categories ────────────────────────────────────
export const responseCategories = [
  "fund_manager",
  "investment_strategy",
  "since_inception_return",
  "recent_performance",
  "benchmark_comparison",
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
// Returned by the voice agent when it classifies a question

export const classificationResultSchema = z.object({
  category: z.enum(responseCategories),
  confidence: z.number().min(0).max(1),
  matchedPattern: z.string().nullable(),
});

export type ClassificationResult = z.infer<typeof classificationResultSchema>;
