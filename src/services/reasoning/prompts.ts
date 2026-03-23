/**
 * LLM prompt templates for the rostering reasoning layer.
 *
 * System prompt defines the LLM's role, output format, and escalation criteria.
 * Context template formats MatchResult + visit/client data into a structured prompt.
 *
 * SECURITY NOTE (PoC 2): Visit/client fields (e.g. service_instructions) are
 * interpolated directly into prompts without sanitisation. For production,
 * implement prompt injection mitigation before using with untrusted input.
 */
import type { MatchResult, ScoredCandidate, WeightConfig } from "../scoring/types";
import type { VisitContext, ClientContext, ReasoningContext } from "./types";

export const ROSTERING_SYSTEM_PROMPT = `You are a rostering assistant for an aged care provider.
You receive scored caregiver rankings and must:

1. RECOMMEND the best caregiver with a clear explanation
2. IDENTIFY if this scenario requires human escalation
3. EXPLAIN your reasoning including trade-offs

ESCALATION CRITERIA — escalate when ANY of these apply:
- No candidate scores above 0.5 overall confidence
- Top candidate has "low" confidence on skills dimension
- Compliance concern (expired qualifications needed for this shift)
- Conflicting information between data sources
- Fewer than 3 viable candidates
- Client is flagged as high-priority and top candidate has no prior relationship
- You are uncertain about the right choice

OUTPUT FORMAT (JSON only, no markdown fences):
{
  "primary": {
    "employee_id": <number>,
    "employee_name": "<string>",
    "explanation": "<1-2 sentence natural language explanation>",
    "confidence": "high|medium|low"
  },
  "escalation": {
    "should_escalate": <boolean>,
    "reason": "<string or null>",
    "urgency": "immediate|before_shift|informational"
  },
  "factors_considered": ["<factor1>", "<factor2>"],
  "trade_offs": ["<trade-off1>", "<trade-off2>"]
}

IMPORTANT:
- Respond ONLY with the JSON object. No other text.
- If there are zero candidates, set primary.employee_id to 0, employee_name to "None", and escalate immediately.
- The escalation.urgency should be "immediate" for critical issues (no candidates, compliance), "before_shift" for concerns, and "informational" for minor notes.`;

/** Format weight config as a human-readable string. */
export function formatWeights(weights: WeightConfig): string {
  return Object.entries(weights)
    .map(([dim, val]) => `${dim}: ${(val * 100).toFixed(0)}%`)
    .join(", ");
}

/** Format a single scored candidate for the prompt. */
export function formatCandidate(candidate: ScoredCandidate, rank: number): string {
  const dims = Object.entries(candidate.dimensions)
    .map(([dim, ds]) => `  ${dim}: ${(ds.score * 100).toFixed(0)}% (${ds.confidence}) — ${ds.reason}`)
    .join("\n");

  const warnings = candidate.warnings.length > 0
    ? `\n  Warnings: ${candidate.warnings.join("; ")}`
    : "";

  return `### Rank ${rank}: ${candidate.employee_name} (ID: ${candidate.employee_id})
  Overall: ${(candidate.overall * 100).toFixed(1)}% | Confidence: ${candidate.confidence}
${dims}${warnings}`;
}

/** Build the full user prompt from visit, client, match result, and context. */
export function buildReasoningPrompt(
  visit: VisitContext,
  client: ClientContext | null,
  matchResult: MatchResult,
  context: ReasoningContext,
): string {
  const candidateList = matchResult.candidates
    .map((c, i) => formatCandidate(c, i + 1))
    .join("\n\n");

  const clientSection = client
    ? `## Client
- Name: ${client.first_name} ${client.last_name}
- Location: ${client.city ?? "Unknown"}, ${client.state ?? "Unknown"}
- Care Needs: ${client.care_needs ?? "Not specified"}`
    : `## Client
- No client assigned to this visit`;

  return `## Shift Details
- Visit ID: ${visit.id}
- Date/Time: ${visit.start_at} to ${visit.end_at}
- Status: ${visit.status}
- Urgency: ${context.urgency}
- Instructions: ${visit.service_instructions ?? "None"}

${clientSection}

## Match Confidence: ${matchResult.match_confidence}

## Data Quality Warnings
${matchResult.data_warnings.length > 0
    ? matchResult.data_warnings.map(w => `- ${w}`).join("\n")
    : "- None"}

## Scored Candidates (${matchResult.candidates.length} of ${matchResult.candidate_pool_size} employees)
Weights used: ${formatWeights(matchResult.weights_used)}
Preset: ${matchResult.preset_name ?? "custom"}

${candidateList || "No eligible candidates after hard constraint filtering."}

Based on the above, provide your recommendation.`;
}
