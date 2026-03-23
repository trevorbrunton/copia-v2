/**
 * Types for PoC 2 evaluation framework (Sprint 6).
 *
 * Defines the structures for evaluating LLM recommendations against
 * human decision baselines across the 32 scoring scenarios.
 */
import type { LLMRecommendation, ScenarioClassification, HumanBaseline } from "../types";
import type { MatchResult } from "../../scoring/types";

/** Result of running a single scenario through scoring + reasoning. */
export interface ScenarioEvaluationResult {
  /** Scenario ID (e.g. "S1", "H1") */
  scenario_id: string;
  /** Classification from human baseline */
  classification: ScenarioClassification;
  /** The scoring engine's MatchResult for this scenario */
  match_result: MatchResult;
  /** The LLM recommendation (null if LLM call failed) */
  recommendation: LLMRecommendation | null;
  /** The human baseline for comparison */
  baseline: HumanBaseline;
  /** Error message if the scenario failed */
  error?: string;
}

/** Escalation comparison for a single scenario. */
export interface EscalationComparison {
  scenario_id: string;
  classification: ScenarioClassification;
  /** Human baseline says escalate */
  human_escalates: boolean;
  /** LLM says escalate */
  llm_escalates: boolean;
  /** LLM escalation urgency (if escalated) */
  llm_urgency?: "immediate" | "before_shift" | "informational";
  /** LLM escalation reason (if escalated) */
  llm_reason?: string | null;
}

/** Aggregated escalation metrics. */
export interface EscalationMetrics {
  /** Total scenarios evaluated */
  total: number;
  /** True positives: human + LLM both escalate */
  true_positives: number;
  /** True negatives: human + LLM both don't escalate */
  true_negatives: number;
  /** False positives: LLM escalates, human doesn't */
  false_positives: number;
  /** False negatives: LLM doesn't escalate, human does (dangerous) */
  false_negatives: number;
  /** Accuracy: (TP + TN) / total */
  accuracy: number;
  /** Appropriate escalation rate: TP / (TP + FN) — target ≥90% */
  sensitivity: number;
  /** False positive rate: FP / (FP + TN) — target <20% */
  false_positive_rate: number;
  /** Precision: TP / (TP + FP) */
  precision: number;
}

/** Metrics broken down by scenario classification. */
export interface ClassificationMetrics {
  classification: ScenarioClassification;
  total: number;
  correct_escalation: number;
  incorrect_escalation: number;
  accuracy: number;
}

/** Full evaluation report. */
export interface EvaluationReport {
  /** When the evaluation was run */
  evaluated_at: string;
  /** LLM model used */
  model: string;
  /** Overall escalation metrics */
  escalation_metrics: EscalationMetrics;
  /** Metrics by scenario classification */
  classification_breakdown: ClassificationMetrics[];
  /** Per-scenario escalation comparisons */
  escalation_comparisons: EscalationComparison[];
  /** Per-scenario results (full detail) */
  scenario_results: ScenarioEvaluationResult[];
  /** Scenarios where LLM disagreed with human on top candidate */
  recommendation_mismatches: RecommendationMismatch[];
  /** Total token usage */
  total_usage: { inputTokens: number; outputTokens: number };
}

/** A case where the LLM recommended a different employee than expected. */
export interface RecommendationMismatch {
  scenario_id: string;
  classification: ScenarioClassification;
  human_decision: string;
  llm_employee_id: number;
  llm_employee_name: string;
  llm_explanation: string;
  llm_confidence: "high" | "medium" | "low";
}
