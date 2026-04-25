/**
 * Screen-matcher composes the rule layer with a constrained-classifier
 * fallback (plan §7a).
 *
 * The classifier is parameterised so tests can pass a deterministic
 * stub. Production wires up `anthropicClassifier` (Claude Haiku, same
 * model used by v1's bedrock-matcher).
 */
import { z } from "zod";
import { STAGE_IDS, type FilterId } from "@/src/screen/funnel";
import { matchIntentRule } from "@/src/screen/intent-rules";
import { INTENT_KINDS, type Intent, type IntentKind } from "@/src/screen/intent";
import { logger } from "@/src/lib/logger";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? "";
const MODEL_ID = process.env.ANTHROPIC_MODEL_ID || "claude-haiku-4-5-20251001";

/** A function that classifies an utterance into one of the known intent kinds. */
export type ClassifierFn = (text: string) => Promise<Intent>;

/**
 * Classify an utterance:
 *   1. Try the deterministic rule layer.
 *   2. On miss, invoke the supplied classifier.
 *   3. If the classifier yields invalid output, return `fallback`.
 */
export async function matchScreenIntent(
  text: string,
  classifier: ClassifierFn = anthropicClassifier
): Promise<Intent> {
  const ruled = matchIntentRule(text);
  if (ruled) return ruled;

  try {
    return await classifier(text);
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "screen-matcher: classifier failed, falling back to fallback intent"
    );
    return { kind: "fallback" };
  }
}

// ─── Anthropic classifier ─────────────────────────────────────

const SYSTEM_PROMPT = `You are an intent classifier for a stock-screening demo. Map the user's question to exactly one of the supported intents.

Allowed intents:
${INTENT_KINDS.map((k) => `  - ${k}`).join("\n")}

Allowed filter ids (for apply_filter only):
${Object.values(STAGE_IDS).filter((id) => id !== "universe").map((id) => `  - ${id}`).join("\n")}

Allowed stock-fact fields (for info_stock_field only):
  - share_price
  - market_cap
  - earnings_status

Output format: a single JSON object with these fields:
  { "kind": <one of the allowed intents>, "filterId"?: <filter id>, "field"?: <stock-fact field> }

Rules:
- Output JSON only. No prose, no code fences, no commentary.
- "filterId" is required only when kind is "apply_filter".
- "field" is allowed only when kind is "info_stock_field" and is optional.
- If the user's intent cannot be matched, output { "kind": "fallback" }.`;

const ResponseSchema = z.object({
  kind: z.enum(INTENT_KINDS as readonly [IntentKind, ...IntentKind[]]),
  filterId: z.string().optional(),
  field: z.enum(["share_price", "market_cap", "earnings_status"]).optional(),
});

const VALID_FILTER_IDS = new Set<string>(Object.values(STAGE_IDS).filter((id) => id !== "universe"));

/** Default classifier: Anthropic Haiku via direct REST. */
export const anthropicClassifier: ClassifierFn = async (text) => {
  if (!ANTHROPIC_API_KEY) {
    // No key configured — degrade to fallback rather than throwing
    // so dev environments without the key still serve the demo.
    return { kind: "fallback" };
  }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL_ID,
      max_tokens: 100,
      temperature: 0,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: text }],
    }),
    // Voice loop budget is tight — fail fast and let the caller fall
    // back to `{ kind: "fallback" }` rather than block on a slow API.
    signal: AbortSignal.timeout(5_000),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Anthropic API error: ${res.status} ${errBody}`);
  }

  const body = await res.json();
  const raw =
    body.content?.find((c: { type: string }) => c.type === "text")?.text?.trim() ??
    "";

  // Strip code fences if the model returned them anyway.
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return { kind: "fallback" };
  }

  const result = ResponseSchema.safeParse(parsed);
  if (!result.success) return { kind: "fallback" };

  const { kind, filterId, field } = result.data;

  switch (kind) {
    case "apply_filter": {
      if (!filterId || !VALID_FILTER_IDS.has(filterId)) return { kind: "fallback" };
      return { kind: "apply_filter", filterId: filterId as FilterId };
    }
    case "info_stock_field":
      return { kind: "info_stock_field", field };
    case "next_step":
      return { kind: "next_step" };
    case "apply_initial_screen":
      return { kind: "apply_initial_screen" };
    case "output_show":
      return { kind: "output_show" };
    case "output_email":
      return { kind: "output_email" };
    case "info_portfolio_overlap":
      return { kind: "info_portfolio_overlap" };
    case "monitoring_enable_daily":
      return { kind: "monitoring_enable_daily" };
    case "restart":
      return { kind: "restart" };
    case "fallback":
      return { kind: "fallback" };
  }
};
