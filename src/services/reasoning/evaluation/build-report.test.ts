import { describe, it, expect } from "vitest";
import { buildEvaluationReport } from "./build-report";
import type { ScenarioEvaluationResult } from "./types";
import type { LLMRecommendation } from "../types";
import type { MatchResult, WeightConfig } from "../../scoring/types";

// ── Helpers ──

const weights: WeightConfig = {
  skills: 0.2, relationship: 0.3, proximity: 0.15, workload: 0.2, acceptance: 0.15,
};

function makeMatchResult(overrides: Partial<MatchResult> = {}): MatchResult {
  return {
    visit_id: 100,
    client_id: 10,
    candidates: [],
    weights_used: weights,
    preset_name: "planned",
    candidate_pool_size: 4,
    eligible_pool_size: 3,
    data_warnings: [],
    match_confidence: "high",
    scored_at: "2026-03-15T08:00:00Z",
    ...overrides,
  };
}

function makeRecommendation(overrides: Partial<LLMRecommendation> = {}): LLMRecommendation {
  return {
    primary: {
      employee_id: 1,
      employee_name: "Alice Smith",
      explanation: "Alice is the best match.",
      confidence: "high",
    },
    escalation: {
      should_escalate: false,
      reason: null,
      urgency: "informational",
    },
    factors_considered: ["proximity", "relationship"],
    trade_offs: ["slightly higher workload"],
    model: "au.anthropic.claude-haiku-4-5-20251001-v1:0",
    usage: { inputTokens: 500, outputTokens: 200 },
    ...overrides,
  };
}

function makeEvalResult(
  scenarioId: string,
  humanEscalates: boolean,
  llmEscalates: boolean,
  overrides: Partial<ScenarioEvaluationResult> = {},
): ScenarioEvaluationResult {
  return {
    scenario_id: scenarioId,
    classification: "straightforward",
    match_result: makeMatchResult(),
    recommendation: makeRecommendation({
      escalation: {
        should_escalate: llmEscalates,
        reason: llmEscalates ? "Concern identified" : null,
        urgency: llmEscalates ? "before_shift" : "informational",
      },
    }),
    baseline: {
      id: scenarioId,
      classification: "straightforward",
      human_decision: "Assign employee 1",
      should_escalate: humanEscalates,
      rationale: "Clear best candidate",
    },
    ...overrides,
  };
}

// ── Tests ──

describe("buildEvaluationReport", () => {
  it("should build a complete report from evaluation results", () => {
    const results: ScenarioEvaluationResult[] = [
      makeEvalResult("S1", false, false),
      makeEvalResult("S2", false, false),
      makeEvalResult("H1", true, true, {
        classification: "constraint_violation",
        baseline: {
          id: "H1",
          classification: "constraint_violation",
          human_decision: "No eligible candidates",
          should_escalate: true,
          rationale: "Zero candidates is critical",
        },
        recommendation: makeRecommendation({
          primary: { employee_id: 0, employee_name: "None", explanation: "No candidates.", confidence: "low" },
          escalation: { should_escalate: true, reason: "No eligible candidates", urgency: "immediate" },
          usage: { inputTokens: 400, outputTokens: 150 },
        }),
      }),
    ];

    const report = buildEvaluationReport(results, "test-model");

    expect(report.model).toBe("test-model");
    expect(report.evaluated_at).toBeDefined();
    expect(report.scenario_results).toHaveLength(3);

    // Escalation metrics
    expect(report.escalation_metrics.total).toBe(3);
    expect(report.escalation_metrics.true_positives).toBe(1);
    expect(report.escalation_metrics.true_negatives).toBe(2);
    expect(report.escalation_metrics.accuracy).toBe(1.0);

    // Classification breakdown
    expect(report.classification_breakdown.length).toBeGreaterThanOrEqual(1);

    // Escalation comparisons
    expect(report.escalation_comparisons).toHaveLength(3);

    // Token usage
    expect(report.total_usage.inputTokens).toBe(1400); // 500 + 500 + 400
    expect(report.total_usage.outputTokens).toBe(550); // 200 + 200 + 150
  });

  it("should identify recommendation mismatches based on employee_id=0", () => {
    const results: ScenarioEvaluationResult[] = [
      makeEvalResult("S1", false, false, {
        baseline: {
          id: "S1",
          classification: "straightforward",
          human_decision: "Assign employee 1",
          should_escalate: false,
          rationale: "Clear winner",
        },
        recommendation: makeRecommendation({
          // LLM recommended employee 0 (none) but human says assign
          primary: { employee_id: 0, employee_name: "None", explanation: "No suitable candidates.", confidence: "low" },
        }),
      }),
    ];

    const report = buildEvaluationReport(results, "test-model");

    expect(report.recommendation_mismatches).toHaveLength(1);
    expect(report.recommendation_mismatches[0].scenario_id).toBe("S1");
    expect(report.recommendation_mismatches[0].llm_employee_id).toBe(0);
  });

  it("should handle failed scenarios (null recommendation)", () => {
    const results: ScenarioEvaluationResult[] = [
      makeEvalResult("S1", false, false),
      {
        scenario_id: "H1",
        classification: "constraint_violation",
        match_result: makeMatchResult(),
        recommendation: null,
        baseline: {
          id: "H1",
          classification: "constraint_violation",
          human_decision: "Escalate",
          should_escalate: true,
          rationale: "No candidates",
        },
        error: "LLM call failed",
      },
    ];

    const report = buildEvaluationReport(results, "test-model");

    // Failed scenarios should be excluded from escalation metrics
    expect(report.escalation_metrics.total).toBe(1);
    expect(report.scenario_results).toHaveLength(2);
  });

  it("should handle empty results", () => {
    const report = buildEvaluationReport([], "test-model");

    expect(report.scenario_results).toHaveLength(0);
    expect(report.escalation_metrics.total).toBe(0);
    expect(report.escalation_metrics.accuracy).toBe(0);
    expect(report.total_usage.inputTokens).toBe(0);
    expect(report.total_usage.outputTokens).toBe(0);
  });

  it("should sum total token usage across all successful scenarios", () => {
    const results: ScenarioEvaluationResult[] = [
      makeEvalResult("S1", false, false),
      makeEvalResult("S2", false, false),
    ];
    // Each has 500 input, 200 output by default

    const report = buildEvaluationReport(results, "test-model");

    expect(report.total_usage.inputTokens).toBe(1000);
    expect(report.total_usage.outputTokens).toBe(400);
  });
});
