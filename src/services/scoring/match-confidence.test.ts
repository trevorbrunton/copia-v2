import { describe, it, expect } from "vitest";
import { computeMatchConfidence } from "./match-confidence";
import type { ScoredCandidate } from "./types";

const makeCandidate = (
  overall: number,
  confidence: "high" | "medium" | "low" = "high"
): ScoredCandidate => ({
  employee_id: 1,
  employee_name: "Test",
  overall,
  confidence,
  dimensions: {
    skills: { score: 1, confidence: "high", reason: "" },
    relationship: { score: 1, confidence: "high", reason: "" },
    proximity: { score: 1, confidence: "high", reason: "" },
    workload: { score: 1, confidence: "high", reason: "" },
    acceptance: { score: 1, confidence: "high", reason: "" },
  },
  warnings: [],
});

describe("computeMatchConfidence", () => {
  it("should return high when clear winner (>0.75, gap >0.10)", () => {
    const candidates = [makeCandidate(0.85), makeCandidate(0.60), makeCandidate(0.50)];

    expect(computeMatchConfidence(candidates)).toBe("high");
  });

  it("should return medium for tight race (gap <0.10)", () => {
    const candidates = [makeCandidate(0.80), makeCandidate(0.75), makeCandidate(0.50)];

    expect(computeMatchConfidence(candidates)).toBe("medium");
  });

  it("should return low when top candidate below 0.50", () => {
    const candidates = [makeCandidate(0.40), makeCandidate(0.30)];

    expect(computeMatchConfidence(candidates)).toBe("low");
  });

  it("should return low with fewer than 3 eligible candidates", () => {
    const candidates = [makeCandidate(0.90)];

    expect(computeMatchConfidence(candidates)).toBe("low");
  });

  it("should return low with empty candidates", () => {
    expect(computeMatchConfidence([])).toBe("low");
  });

  it("should return medium when any candidate has low dimension confidence", () => {
    const candidates = [
      makeCandidate(0.85, "low"),
      makeCandidate(0.60),
      makeCandidate(0.50),
    ];

    expect(computeMatchConfidence(candidates)).toBe("medium");
  });
});
