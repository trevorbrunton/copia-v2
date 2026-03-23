/**
 * Parses and validates LLM response JSON into a structured LLMResponsePayload.
 *
 * Handles common LLM output quirks:
 * - Markdown code fences wrapping JSON
 * - Leading/trailing whitespace
 * - Invalid JSON (returns structured error)
 */
import { z } from "zod";
import type { LLMResponsePayload } from "./types";

const confidenceSchema = z.enum(["high", "medium", "low"]);

const urgencySchema = z.enum(["immediate", "before_shift", "informational"]);

export const llmResponseSchema = z.object({
  primary: z.object({
    employee_id: z.number(),
    employee_name: z.string(),
    explanation: z.string(),
    confidence: confidenceSchema,
  }),
  escalation: z.object({
    should_escalate: z.boolean(),
    reason: z.string().nullable(),
    urgency: urgencySchema,
  }),
  factors_considered: z.array(z.string()),
  trade_offs: z.array(z.string()),
});

export type ParseResult =
  | { ok: true; data: LLMResponsePayload }
  | { ok: false; error: string };

/**
 * Parse LLM text response into a validated LLMResponsePayload.
 * Strips markdown fences and validates against the Zod schema.
 */
export function parseLLMResponse(text: string): ParseResult {
  const cleaned = stripMarkdownFences(text).trim();

  if (!cleaned) {
    return { ok: false, error: "Empty response from LLM" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const preview = cleaned.length > 100 ? `${cleaned.slice(0, 100)}...` : cleaned;
    return { ok: false, error: `Invalid JSON: ${preview}` };
  }

  const result = llmResponseSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    return { ok: false, error: `Validation failed: ${issues}` };
  }

  return { ok: true, data: result.data };
}

/** Strip markdown code fences (```json ... ``` or ``` ... ```) from LLM output. */
function stripMarkdownFences(text: string): string {
  const fencePattern = /^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/;
  const match = text.trim().match(fencePattern);
  return match ? match[1] : text;
}
