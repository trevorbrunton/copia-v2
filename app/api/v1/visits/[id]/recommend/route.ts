import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAuthContext } from "@/src/server/require-auth-context";
import { handleAppError, ValidationError, ExternalServiceError } from "@/src/server/errors";
import { computeMatch, type MatchConfig } from "@/src/services/scoring";
import { getRecommendation } from "@/src/services/reasoning";
import { buildRecommendationContext } from "@/src/services/recommendation-context";

/**
 * Recommend endpoint — chains scoring → LLM reasoning for a visit.
 *
 * Returns both the MatchResult and the LLMRecommendation so the UI can
 * display scored candidates alongside the LLM's pick and explanation.
 */

const WeightsSchema = z.object({
  skills: z.number().min(0).max(1),
  relationship: z.number().min(0).max(1),
  proximity: z.number().min(0).max(1),
  workload: z.number().min(0).max(1),
  acceptance: z.number().min(0).max(1),
}).refine(
  (w) => Math.abs(w.skills + w.relationship + w.proximity + w.workload + w.acceptance - 1.0) < 0.001,
  { message: "Weights must sum to 1.0" }
);

const RecommendRequestSchema = z.object({
  weights: WeightsSchema.optional(),
  preset: z.enum(["planned", "urgent", "high_value_client", "new_client", "efficiency"]).optional(),
  limit: z.number().int().min(1).max(50).optional(),
}).refine(
  (d) => !(d.weights && d.preset),
  { message: "Provide either weights or preset, not both" }
);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const traceId = crypto.randomUUID();
  try {
    await requireAuthContext(request, traceId);

    const { id } = await params;
    const visitId = Number(id);
    if (!Number.isInteger(visitId) || visitId <= 0) {
      return handleAppError(
        { issues: [{ message: "Visit ID must be a positive integer", path: ["id"] }] },
        traceId
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ValidationError("Invalid JSON body");
    }
    const parsed = RecommendRequestSchema.parse(body);

    // Build match config
    const config: MatchConfig = {};
    if (parsed.weights) config.weights = parsed.weights;
    if (parsed.preset) config.preset = parsed.preset;
    if (parsed.limit) config.limit = parsed.limit;

    // Step 1: Score candidates
    const matchResult = await computeMatch(visitId, config);

    // Step 2: Build recommendation context (shared helper)
    const urgency = parsed.preset === "urgent" ? "urgent" as const : "planned" as const;
    const { visit, client, context } = await buildRecommendationContext(
      visitId,
      matchResult,
      urgency,
    );

    // Step 3: Get LLM recommendation
    try {
      const recommendation = await getRecommendation({
        visit,
        client,
        matchResult,
        context,
      });

      return Response.json({ match_result: matchResult, recommendation });
    } catch (err) {
      throw new ExternalServiceError(
        err instanceof Error ? err.message : "LLM reasoning failed"
      );
    }
  } catch (err) {
    return handleAppError(err, traceId);
  }
}
