import type { DimensionScore, OfferRef } from "./types";

/** Contact outcome from DappaAi's own task history. */
export interface ContactOutcome {
  response: "accepted" | "declined" | "expired";
  timestamp: string; // ISO date
}

const RECENCY_HALF_LIFE_DAYS = 30;

/**
 * Scores acceptance likelihood: accepted / (accepted + declined).
 * Pending offers are ignored. Decision G8: simple ratio for PoC.
 *
 * When DappaAi contact outcomes are provided, they are merged with
 * AlayaCare offer history. Recent DappaAi data is weighted higher
 * via exponential decay (half-life = 30 days).
 */
export function scoreAcceptance(
  offers: OfferRef[],
  dappaAiOutcomes?: ContactOutcome[],
): DimensionScore {
  const accepted = offers.filter((o) => o.status === "accepted").length;
  const declined = offers.filter((o) => o.status === "declined").length;
  const resolved = accepted + declined;

  // If no DappaAi outcomes, use original AlayaCare-only logic
  if (!dappaAiOutcomes || dappaAiOutcomes.length === 0) {
    if (resolved === 0) {
      return {
        score: 0.5,
        confidence: "low",
        reason: "No resolved offer history",
      };
    }

    const score = accepted / resolved;
    const confidence: DimensionScore["confidence"] =
      resolved >= 10 ? "high" : resolved >= 3 ? "medium" : "low";

    return {
      score,
      confidence,
      reason: `${accepted} accepted of ${resolved} resolved offers`,
    };
  }

  // Merge: AlayaCare offers (weight = 1.0) + DappaAi outcomes (recency-weighted)
  const now = Date.now();
  let weightedAccepted = accepted;
  let weightedTotal = resolved;

  for (const outcome of dappaAiOutcomes) {
    if (outcome.response === "expired") continue; // Skip expired — not a clear signal
    const ageMs = now - new Date(outcome.timestamp).getTime();
    const ageDays = Math.max(ageMs / 86_400_000, 0);
    const weight = Math.pow(0.5, ageDays / RECENCY_HALF_LIFE_DAYS);

    weightedTotal += weight;
    if (outcome.response === "accepted") {
      weightedAccepted += weight;
    }
  }

  if (weightedTotal === 0) {
    return {
      score: 0.5,
      confidence: "low",
      reason: "No resolved offer or contact history",
    };
  }

  const score = weightedAccepted / weightedTotal;
  const totalDataPoints = resolved + dappaAiOutcomes.filter((o) => o.response !== "expired").length;
  const confidence: DimensionScore["confidence"] =
    totalDataPoints >= 10 ? "high" : totalDataPoints >= 3 ? "medium" : "low";

  return {
    score,
    confidence,
    reason: `${accepted} AlayaCare offers + ${dappaAiOutcomes.length} DappaAi outcomes (recency-weighted)`,
  };
}
