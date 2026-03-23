import type { DimensionScore } from "./types";

const OVERLOAD_PENALTY = 1.5;

/**
 * Scores workload balance using Gaussian curve with asymmetric overload penalty.
 * Decision G4: exp(-0.5 × z²) where z is penalised 1.5× for above-mean.
 */
export function scoreWorkload(
  empShiftCount: number,
  poolMean: number,
  poolStddev: number
): DimensionScore {
  if (poolStddev === 0) {
    return {
      score: 1.0,
      confidence: "medium",
      reason: `All employees have ${poolMean} shifts (no variance)`,
    };
  }

  let z = (empShiftCount - poolMean) / poolStddev;

  // Asymmetric penalty: overloaded employees penalised more
  if (z > 0) {
    z *= OVERLOAD_PENALTY;
  }

  const score = Math.exp(-0.5 * z * z);

  return {
    score,
    confidence: "high",
    reason: `${empShiftCount} shifts (mean ${poolMean.toFixed(1)}, σ ${poolStddev.toFixed(1)})`,
  };
}
