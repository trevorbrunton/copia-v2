import { computeMatch } from "@/src/services/scoring";
import { getRecommendation } from "@/src/services/reasoning";
import { buildRecommendationContext } from "@/src/services/recommendation-context";
import { ValidationError } from "@/src/server/errors";
import { ExternalServiceError } from "@/src/server/errors";
import { logger } from "@/src/lib/logger";
import type { AlayaCareEvent } from "@/src/lib/alayacare-events/types";

export async function handleVisitVacated(
  event: AlayaCareEvent,
  traceId: string,
): Promise<unknown> {
  const rawVisitId = Number(event.payload.visit_id);
  if (!Number.isInteger(rawVisitId) || rawVisitId <= 0) {
    throw new ValidationError("visit_id must be a positive integer");
  }

  logger.info({ traceId, visitId: rawVisitId }, "Processing vacated visit");

  // 1. Score candidates
  const matchResult = await computeMatch(rawVisitId, {
    preset: "urgent",
  });

  // 2. Build recommendation context (shared with recommend route)
  const { visit, client, context } = await buildRecommendationContext(
    rawVisitId,
    matchResult,
    "urgent",
  );

  // 3. LLM reasoning
  let recommendation;
  try {
    recommendation = await getRecommendation({
      visit,
      client,
      matchResult,
      context,
    });
  } catch (err) {
    throw new ExternalServiceError(
      err instanceof Error ? err.message : "LLM reasoning failed"
    );
  }

  logger.info(
    {
      traceId,
      visitId: rawVisitId,
      topCandidate: recommendation.primary.employee_name,
      confidence: recommendation.primary.confidence,
    },
    "Recommendation generated for vacated visit",
  );

  return {
    visit_id: rawVisitId,
    match_confidence: matchResult.match_confidence,
    top_candidates: matchResult.candidates.slice(0, 3).map((c) => ({
      employee_id: c.employee_id,
      employee_name: c.employee_name,
      overall_score: c.overall,
    })),
    recommendation: {
      primary: recommendation.primary,
      escalation: recommendation.escalation,
      factors_considered: recommendation.factors_considered,
    },
  };
}
