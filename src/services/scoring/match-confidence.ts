import type { ScoredCandidate } from "./types";

/**
 * Computes distribution-based match confidence per decision G6.
 * - High: top > 0.75, gap to #2 > 0.10, all high confidence, 3+ candidates
 * - Medium: top 0.50–0.75, or gap < 0.10, or any dimension incomplete
 * - Low: top < 0.50, or 2+ incomplete, or fewer than 3 eligible
 */
export function computeMatchConfidence(
  candidates: ScoredCandidate[]
): "high" | "medium" | "low" {
  if (candidates.length < 3) return "low";

  const top = candidates[0].overall;
  const second = candidates[1].overall;
  const gap = top - second;

  if (top < 0.5) return "low";

  const hasLowConfidence = candidates.some((c) => c.confidence === "low");

  if (top > 0.75 && gap > 0.1 && !hasLowConfidence) return "high";

  return "medium";
}
