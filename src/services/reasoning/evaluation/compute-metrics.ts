/**
 * Escalation metrics calculator for PoC 2 evaluation (Sprint 6).
 *
 * Computes confusion matrix metrics (TP, TN, FP, FN), accuracy,
 * sensitivity (recall), false positive rate, and precision from
 * escalation comparisons between LLM and human baselines.
 */
import type { EscalationComparison, EscalationMetrics, ClassificationMetrics } from "./types";

/**
 * Compute escalation metrics from a list of comparisons.
 *
 * Uses standard confusion matrix terminology:
 * - TP: human escalates, LLM escalates (correct escalation)
 * - TN: human doesn't escalate, LLM doesn't escalate (correct non-escalation)
 * - FP: human doesn't escalate, LLM escalates (unnecessary escalation)
 * - FN: human escalates, LLM doesn't escalate (missed escalation — dangerous)
 */
export function computeEscalationMetrics(
  comparisons: EscalationComparison[],
): EscalationMetrics {
  const total = comparisons.length;

  if (total === 0) {
    return {
      total: 0,
      true_positives: 0,
      true_negatives: 0,
      false_positives: 0,
      false_negatives: 0,
      accuracy: 0,
      sensitivity: 0,
      false_positive_rate: 0,
      precision: 0,
    };
  }

  let tp = 0;
  let tn = 0;
  let fp = 0;
  let fn = 0;

  for (const c of comparisons) {
    if (c.human_escalates && c.llm_escalates) tp++;
    else if (!c.human_escalates && !c.llm_escalates) tn++;
    else if (!c.human_escalates && c.llm_escalates) fp++;
    else fn++; // human escalates, LLM doesn't
  }

  const accuracy = (tp + tn) / total;
  const sensitivity = tp + fn > 0 ? tp / (tp + fn) : 0;
  const falsePositiveRate = fp + tn > 0 ? fp / (fp + tn) : 0;
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;

  return {
    total,
    true_positives: tp,
    true_negatives: tn,
    false_positives: fp,
    false_negatives: fn,
    accuracy,
    sensitivity,
    false_positive_rate: falsePositiveRate,
    precision,
  };
}

/**
 * Compute escalation accuracy broken down by scenario classification.
 *
 * For each classification, reports how many escalation decisions
 * matched the human baseline vs how many didn't.
 */
export function computeClassificationBreakdown(
  comparisons: EscalationComparison[],
): ClassificationMetrics[] {
  const groups = new Map<string, EscalationComparison[]>();

  for (const c of comparisons) {
    const existing = groups.get(c.classification) ?? [];
    existing.push(c);
    groups.set(c.classification, existing);
  }

  const results: ClassificationMetrics[] = [];

  for (const [classification, items] of groups) {
    const correct = items.filter(
      (c) => c.human_escalates === c.llm_escalates,
    ).length;
    const incorrect = items.length - correct;

    results.push({
      classification: classification as ClassificationMetrics["classification"],
      total: items.length,
      correct_escalation: correct,
      incorrect_escalation: incorrect,
      accuracy: items.length > 0 ? correct / items.length : 0,
    });
  }

  return results;
}
