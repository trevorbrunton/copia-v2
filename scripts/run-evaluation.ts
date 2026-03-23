#!/usr/bin/env bun
/**
 * PoC 2 Evaluation Runner (Sprint 6)
 *
 * Runs all 32 scoring scenarios through the full pipeline:
 *   scoring engine → LLM reasoning → evaluation against human baselines
 *
 * Outputs an evaluation report to docs/evaluation-report.json with:
 *   - Escalation metrics (accuracy, sensitivity, false positive rate)
 *   - Classification breakdown
 *   - Per-scenario comparisons
 *   - Recommendation mismatches
 *   - Token usage summary
 *
 * Prerequisites:
 *   - ALAYACARE_PUBLIC_KEY and ALAYACARE_PRIVATE_KEY env vars set
 *   - AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY env vars set
 *   - mock-alaya server accessible at ALAYACARE_API_URL
 *
 * Mock-Alaya Data Assumptions:
 *   The mock-alaya server (https://mock-alaya.vercel.app) must serve data
 *   matching the scenario fixtures defined in scenario-test-helpers.ts:
 *   - Visit ID: DEFAULT_VISIT_ID (100)
 *   - Employees: IDs 1–150 with skills, locations, and schedules
 *   - Client: ID 10 with location and visit history
 *   - Skills, offers, and schedules as configured per scenario
 *   If the mock data doesn't match, scoring results will diverge from
 *   unit test expectations and evaluation metrics may be unreliable.
 *
 * Usage:
 *   bun scripts/run-evaluation.ts
 *   bun scripts/run-evaluation.ts --scenario S1    # Run single scenario
 *   bun scripts/run-evaluation.ts --dry-run        # Show scenarios without running LLM
 */
import { SCENARIO_BASELINES } from "../src/services/reasoning/scenario-baselines";
import { buildEvaluationReport } from "../src/services/reasoning/evaluation/build-report";
import { runScenarioEvaluation } from "../src/services/reasoning/evaluation/run-scenario";
import { DEFAULT_MODEL } from "../src/lib/llm/types";
import { SCENARIOS } from "../src/services/scoring/scenario-test-helpers";
import type { ScenarioEvaluationResult } from "../src/services/reasoning/evaluation/types";
import { writeFileSync } from "fs";
import { join } from "path";

// ── CLI Args ──
const args = process.argv.slice(2);
const singleScenario = args.find((a) => a.startsWith("--scenario="))?.split("=")[1]
  ?? (args.indexOf("--scenario") >= 0 ? args[args.indexOf("--scenario") + 1] : null);
const dryRun = args.includes("--dry-run");

// ── Main ──

async function runEvaluation() {
  console.log("╔══════════════════════════════════════════════╗");
  console.log("║  PoC 2 Evaluation Runner — Sprint 6          ║");
  console.log("╚══════════════════════════════════════════════╝");
  console.log();

  // Determine which scenarios to run
  let scenariosToRun = SCENARIOS;
  if (singleScenario) {
    scenariosToRun = SCENARIOS.filter((s) => s.id === singleScenario);
    if (scenariosToRun.length === 0) {
      console.error(`Scenario "${singleScenario}" not found. Available: ${SCENARIOS.map((s) => s.id).join(", ")}`);
      process.exit(1);
    }
  }

  console.log(`Scenarios: ${scenariosToRun.length} of ${SCENARIOS.length}`);
  console.log(`Model: ${DEFAULT_MODEL}`);
  console.log(`Mode: ${dryRun ? "DRY RUN (no LLM calls)" : "LIVE"}`);
  console.log();

  if (dryRun) {
    console.log("Scenarios that would be evaluated:");
    for (const s of scenariosToRun) {
      const baseline = SCENARIO_BASELINES.find((b) => b.id === s.id);
      console.log(`  ${s.id}: ${baseline?.classification ?? "?"} — escalate: ${baseline?.should_escalate ?? "?"}`);
    }
    return;
  }

  const results: ScenarioEvaluationResult[] = [];
  let completed = 0;

  for (const scenario of scenariosToRun) {
    const baseline = SCENARIO_BASELINES.find((b) => b.id === scenario.id);
    if (!baseline) {
      console.warn(`  ⚠ No baseline for scenario ${scenario.id}, skipping`);
      continue;
    }

    completed++;
    const progress = `[${completed}/${scenariosToRun.length}]`;

    try {
      const result = await runScenarioEvaluation(scenario, baseline);
      results.push(result);

      const escalationMatch = result.recommendation
        ? result.recommendation.escalation.should_escalate === baseline.should_escalate
          ? "✓"
          : "✗"
        : "ERR";

      console.log(
        `  ${progress} ${scenario.id} (${baseline.classification}) — ` +
        `escalation: ${escalationMatch} | ` +
        `${result.recommendation ? `employee: ${result.recommendation.primary.employee_id}` : `error: ${result.error}`}`
      );
    } catch (error) {
      console.error(`  ${progress} ${scenario.id} FAILED: ${error}`);
      results.push({
        scenario_id: scenario.id,
        classification: baseline.classification,
        match_result: { visit_id: 100, client_id: null, candidates: [], weights_used: { skills: 0.2, relationship: 0.2, proximity: 0.2, workload: 0.2, acceptance: 0.2 }, preset_name: null, candidate_pool_size: 0, eligible_pool_size: 0, data_warnings: [], match_confidence: "low", scored_at: new Date().toISOString() },
        recommendation: null,
        baseline,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Build report
  const report = buildEvaluationReport(results, DEFAULT_MODEL);

  // Print summary
  console.log();
  console.log("══════════════════════════════════════════════");
  console.log("  ESCALATION METRICS");
  console.log("══════════════════════════════════════════════");
  const m = report.escalation_metrics;
  console.log(`  Total scenarios:      ${m.total}`);
  console.log(`  True positives:       ${m.true_positives}`);
  console.log(`  True negatives:       ${m.true_negatives}`);
  console.log(`  False positives:      ${m.false_positives}`);
  console.log(`  False negatives:      ${m.false_negatives}`);
  console.log(`  Accuracy:             ${(m.accuracy * 100).toFixed(1)}%`);
  console.log(`  Sensitivity (recall): ${(m.sensitivity * 100).toFixed(1)}% (target: ≥90%)`);
  console.log(`  False positive rate:  ${(m.false_positive_rate * 100).toFixed(1)}% (target: <20%)`);
  console.log(`  Precision:            ${(m.precision * 100).toFixed(1)}%`);
  console.log();

  console.log("  CLASSIFICATION BREAKDOWN");
  for (const cb of report.classification_breakdown) {
    console.log(`    ${cb.classification}: ${cb.correct_escalation}/${cb.total} correct (${(cb.accuracy * 100).toFixed(0)}%)`);
  }
  console.log();

  if (report.recommendation_mismatches.length > 0) {
    console.log("  RECOMMENDATION MISMATCHES");
    for (const mm of report.recommendation_mismatches) {
      console.log(`    ${mm.scenario_id}: LLM said "${mm.llm_employee_name}" (id=${mm.llm_employee_id}), human said: "${mm.human_decision}"`);
    }
    console.log();
  }

  console.log(`  Token usage: ${report.total_usage.inputTokens} input, ${report.total_usage.outputTokens} output`);
  console.log();

  // Write report
  const reportPath = join(process.cwd(), "docs", "evaluation-report.json");
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`Report written to: ${reportPath}`);

  // Exit code based on targets
  const passesTargets =
    m.sensitivity >= 0.9 && m.false_positive_rate < 0.2;
  if (!passesTargets) {
    console.log();
    console.log("⚠ Escalation targets NOT met. Prompt tuning may be needed.");
  }
}

runEvaluation().catch((err) => {
  console.error("Evaluation failed:", err);
  process.exit(1);
});
