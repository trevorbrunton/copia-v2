/**
 * Evaluation report builder for PoC 2 (Sprint 6).
 *
 * Takes per-scenario evaluation results and builds a comprehensive
 * report with escalation metrics, classification breakdown, mismatches,
 * and token usage aggregation.
 */
import type {
  ScenarioEvaluationResult,
  EvaluationReport,
  EscalationComparison,
  RecommendationMismatch,
} from "./types";
import { computeEscalationMetrics, computeClassificationBreakdown } from "./compute-metrics";

/**
 * Build a full evaluation report from per-scenario results.
 *
 * Scenarios with `recommendation === null` (LLM failures) are included
 * in the report but excluded from escalation metrics calculations.
 */
export function buildEvaluationReport(
  results: ScenarioEvaluationResult[],
  model: string,
): EvaluationReport {
  // Filter to successful scenarios for metrics
  const successful = results.filter((r) => r.recommendation !== null);

  // Build escalation comparisons from successful results
  const escalationComparisons: EscalationComparison[] = successful.map((r) => ({
    scenario_id: r.scenario_id,
    classification: r.classification,
    human_escalates: r.baseline.should_escalate,
    llm_escalates: r.recommendation!.escalation.should_escalate,
    llm_urgency: r.recommendation!.escalation.urgency,
    llm_reason: r.recommendation!.escalation.reason,
  }));

  // Compute metrics
  const escalationMetrics = computeEscalationMetrics(escalationComparisons);
  const classificationBreakdown = computeClassificationBreakdown(escalationComparisons);

  // Identify recommendation mismatches
  // A mismatch is when the LLM recommended employee_id=0 but human says to assign,
  // or when the baseline doesn't escalate but LLM says no candidate.
  const recommendationMismatches: RecommendationMismatch[] = successful
    .filter((r) => {
      const rec = r.recommendation!;
      // Mismatch if LLM says no candidate (id=0) but human doesn't escalate
      if (rec.primary.employee_id === 0 && !r.baseline.should_escalate) return true;
      return false;
    })
    .map((r) => ({
      scenario_id: r.scenario_id,
      classification: r.classification,
      human_decision: r.baseline.human_decision,
      llm_employee_id: r.recommendation!.primary.employee_id,
      llm_employee_name: r.recommendation!.primary.employee_name,
      llm_explanation: r.recommendation!.primary.explanation,
      llm_confidence: r.recommendation!.primary.confidence,
    }));

  // Sum token usage
  const totalUsage = successful.reduce(
    (acc, r) => ({
      inputTokens: acc.inputTokens + (r.recommendation!.usage?.inputTokens ?? 0),
      outputTokens: acc.outputTokens + (r.recommendation!.usage?.outputTokens ?? 0),
    }),
    { inputTokens: 0, outputTokens: 0 },
  );

  return {
    evaluated_at: new Date().toISOString(),
    model,
    escalation_metrics: escalationMetrics,
    classification_breakdown: classificationBreakdown,
    escalation_comparisons: escalationComparisons,
    scenario_results: results,
    recommendation_mismatches: recommendationMismatches,
    total_usage: totalUsage,
  };
}
