import { describe, it, expect } from "vitest";
import {
  computeEscalationMetrics,
  computeClassificationBreakdown,
} from "./compute-metrics";
import type { EscalationComparison } from "./types";
import type { ScenarioClassification } from "../types";

// ── Helper ──

function makeComparison(
  id: string,
  classification: ScenarioClassification,
  humanEscalates: boolean,
  llmEscalates: boolean,
): EscalationComparison {
  return {
    scenario_id: id,
    classification,
    human_escalates: humanEscalates,
    llm_escalates: llmEscalates,
  };
}

// ── computeEscalationMetrics ──

describe("computeEscalationMetrics", () => {
  it("should return perfect metrics when all predictions match", () => {
    const comparisons: EscalationComparison[] = [
      makeComparison("S1", "straightforward", false, false),
      makeComparison("S2", "straightforward", false, false),
      makeComparison("H1", "constraint_violation", true, true),
      makeComparison("R4", "edge_case", true, true),
    ];

    const metrics = computeEscalationMetrics(comparisons);

    expect(metrics.total).toBe(4);
    expect(metrics.true_positives).toBe(2);
    expect(metrics.true_negatives).toBe(2);
    expect(metrics.false_positives).toBe(0);
    expect(metrics.false_negatives).toBe(0);
    expect(metrics.accuracy).toBe(1.0);
    expect(metrics.sensitivity).toBe(1.0);
    expect(metrics.false_positive_rate).toBe(0);
    expect(metrics.precision).toBe(1.0);
  });

  it("should correctly count false positives (LLM over-escalates)", () => {
    const comparisons: EscalationComparison[] = [
      makeComparison("S1", "straightforward", false, true), // FP
      makeComparison("S2", "straightforward", false, false), // TN
      makeComparison("H1", "constraint_violation", true, true), // TP
    ];

    const metrics = computeEscalationMetrics(comparisons);

    expect(metrics.false_positives).toBe(1);
    expect(metrics.true_negatives).toBe(1);
    expect(metrics.true_positives).toBe(1);
    expect(metrics.false_positive_rate).toBeCloseTo(0.5); // 1 / (1 + 1)
    expect(metrics.precision).toBeCloseTo(0.5); // 1 / (1 + 1)
  });

  it("should correctly count false negatives (LLM misses escalation)", () => {
    const comparisons: EscalationComparison[] = [
      makeComparison("H1", "constraint_violation", true, false), // FN — dangerous
      makeComparison("R4", "edge_case", true, true), // TP
      makeComparison("S1", "straightforward", false, false), // TN
    ];

    const metrics = computeEscalationMetrics(comparisons);

    expect(metrics.false_negatives).toBe(1);
    expect(metrics.sensitivity).toBeCloseTo(0.5); // 1 / (1 + 1)
  });

  it("should handle all false negatives (worst case)", () => {
    const comparisons: EscalationComparison[] = [
      makeComparison("H1", "constraint_violation", true, false),
      makeComparison("R4", "edge_case", true, false),
      makeComparison("S4", "edge_case", true, false),
    ];

    const metrics = computeEscalationMetrics(comparisons);

    expect(metrics.sensitivity).toBe(0);
    expect(metrics.false_negatives).toBe(3);
    expect(metrics.true_positives).toBe(0);
  });

  it("should handle all false positives (LLM escalates everything)", () => {
    const comparisons: EscalationComparison[] = [
      makeComparison("S1", "straightforward", false, true),
      makeComparison("S2", "straightforward", false, true),
      makeComparison("S3", "straightforward", false, true),
    ];

    const metrics = computeEscalationMetrics(comparisons);

    expect(metrics.false_positives).toBe(3);
    expect(metrics.true_negatives).toBe(0);
    expect(metrics.false_positive_rate).toBe(1.0);
  });

  it("should handle empty comparisons", () => {
    const metrics = computeEscalationMetrics([]);

    expect(metrics.total).toBe(0);
    expect(metrics.accuracy).toBe(0);
    expect(metrics.sensitivity).toBe(0);
    expect(metrics.false_positive_rate).toBe(0);
    expect(metrics.precision).toBe(0);
  });

  it("should handle no positive cases (no escalations expected)", () => {
    const comparisons: EscalationComparison[] = [
      makeComparison("S1", "straightforward", false, false),
      makeComparison("S2", "straightforward", false, false),
    ];

    const metrics = computeEscalationMetrics(comparisons);

    expect(metrics.sensitivity).toBe(0); // No positives → 0 by convention
    expect(metrics.accuracy).toBe(1.0);
    expect(metrics.precision).toBe(0); // No predicted positives
  });

  it("should compute accuracy correctly with mixed results", () => {
    // 2 TP + 3 TN + 1 FP + 1 FN = 7 total
    // accuracy = (2 + 3) / 7 ≈ 0.714
    const comparisons: EscalationComparison[] = [
      makeComparison("H1", "constraint_violation", true, true), // TP
      makeComparison("R4", "edge_case", true, true), // TP
      makeComparison("S1", "straightforward", false, false), // TN
      makeComparison("S2", "straightforward", false, false), // TN
      makeComparison("S3", "straightforward", false, false), // TN
      makeComparison("M3", "edge_case", false, true), // FP
      makeComparison("S4", "edge_case", true, false), // FN
    ];

    const metrics = computeEscalationMetrics(comparisons);

    expect(metrics.accuracy).toBeCloseTo(5 / 7);
    expect(metrics.sensitivity).toBeCloseTo(2 / 3); // TP / (TP + FN)
    expect(metrics.false_positive_rate).toBeCloseTo(1 / 4); // FP / (FP + TN)
    expect(metrics.precision).toBeCloseTo(2 / 3); // TP / (TP + FP)
  });
});

// ── computeClassificationBreakdown ──

describe("computeClassificationBreakdown", () => {
  it("should group escalation accuracy by classification", () => {
    const comparisons: EscalationComparison[] = [
      makeComparison("S1", "straightforward", false, false), // correct
      makeComparison("S2", "straightforward", false, true), // incorrect
      makeComparison("H1", "constraint_violation", true, true), // correct
      makeComparison("H2", "constraint_violation", false, false), // correct
      makeComparison("R4", "edge_case", true, true), // correct
      makeComparison("R5", "edge_case", true, false), // incorrect
    ];

    const breakdown = computeClassificationBreakdown(comparisons);

    const straightforward = breakdown.find((b) => b.classification === "straightforward");
    expect(straightforward).toBeDefined();
    expect(straightforward!.total).toBe(2);
    expect(straightforward!.correct_escalation).toBe(1);
    expect(straightforward!.incorrect_escalation).toBe(1);
    expect(straightforward!.accuracy).toBeCloseTo(0.5);

    const constraint = breakdown.find((b) => b.classification === "constraint_violation");
    expect(constraint!.total).toBe(2);
    expect(constraint!.correct_escalation).toBe(2);
    expect(constraint!.accuracy).toBe(1.0);

    const edgeCase = breakdown.find((b) => b.classification === "edge_case");
    expect(edgeCase!.total).toBe(2);
    expect(edgeCase!.correct_escalation).toBe(1);
    expect(edgeCase!.accuracy).toBeCloseTo(0.5);
  });

  it("should handle empty comparisons", () => {
    const breakdown = computeClassificationBreakdown([]);
    expect(breakdown).toHaveLength(0);
  });

  it("should handle single classification", () => {
    const comparisons: EscalationComparison[] = [
      makeComparison("S1", "straightforward", false, false),
      makeComparison("S2", "straightforward", false, false),
    ];

    const breakdown = computeClassificationBreakdown(comparisons);

    expect(breakdown).toHaveLength(1);
    expect(breakdown[0].classification).toBe("straightforward");
    expect(breakdown[0].accuracy).toBe(1.0);
  });
});
