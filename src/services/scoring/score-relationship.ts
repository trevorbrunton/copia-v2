import type { DimensionScore, PriorVisitRef } from "./types";

/**
 * Scores client-employee relationship history using logarithmic formula
 * with recency multiplier. Decision G5: ln(count+1)/ln(20) × recency.
 */
export function scoreRelationship(
  priorVisits: PriorVisitRef[],
  now: Date
): DimensionScore {
  const count = priorVisits.length;

  if (count === 0) {
    return {
      score: 0.0,
      confidence: "low",
      reason: "No prior visits with this client",
    };
  }

  // Logarithmic base score: ln(count+1)/ln(20), capped at 1.0
  const baseScore = Math.min(1.0, Math.log(count + 1) / Math.log(20));

  // Recency: most recent visit determines multiplier
  const mostRecentMs = Math.max(
    ...priorVisits.map((v) => new Date(v.start_at).getTime())
  );
  const daysSinceLast = (now.getTime() - mostRecentMs) / (24 * 60 * 60 * 1000);

  const recencyMultiplier =
    daysSinceLast <= 7
      ? 1.0
      : daysSinceLast <= 30
        ? 0.8
        : daysSinceLast <= 90
          ? 0.6
          : 0.4;

  const score = Math.min(1.0, baseScore * recencyMultiplier);

  const confidence: DimensionScore["confidence"] =
    count >= 10 ? "high" : count >= 3 ? "medium" : "low";

  return {
    score,
    confidence,
    reason: `${count} prior visits, most recent ${Math.round(daysSinceLast)}d ago (×${recencyMultiplier})`,
  };
}
