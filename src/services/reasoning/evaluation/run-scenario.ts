/**
 * Scenario runner for PoC 2 evaluation (Sprint 6).
 *
 * Bridges the scoring engine scenarios with the reasoning service:
 * 1. Sets up mock data for a scenario (already done by caller via setup())
 * 2. Runs computeMatch() to get a MatchResult
 * 3. Builds VisitContext + ClientContext from the MatchResult
 * 4. Calls getRecommendation() with the MatchResult + context
 * 5. Returns a ScenarioEvaluationResult for comparison against baseline
 */
import type { ScenarioEvaluationResult } from "./types";
import type { HumanBaseline, VisitContext, ClientContext, ReasoningContext } from "../types";
import {
  DEFAULT_VISIT_ID,
  DEFAULT_VISIT_START,
  DEFAULT_VISIT_END,
  type ScenarioRun,
} from "../../scoring/scenario-test-helpers";
import { computeMatch } from "../../scoring/compute-match";
import type { WeightConfig } from "../../scoring/types";
import { getRecommendation } from "../reasoning-service";

/**
 * Run a single scenario through scoring → reasoning and compare against baseline.
 *
 * The scenario's setup() function must have already been called to configure
 * the mocked alayaFetch before this function is invoked.
 */
export async function runScenarioEvaluation(
  scenario: ScenarioRun,
  baseline: HumanBaseline,
): Promise<ScenarioEvaluationResult> {
  // Step 1: Run scoring engine to get MatchResult
  const matchResult = await computeMatch(DEFAULT_VISIT_ID, {
    preset: scenario.preset as "planned" | "urgent" | "efficiency" | "high_value_client" | "new_client" | undefined,
    weights: scenario.weights as WeightConfig | undefined,
    limit: scenario.limit,
  });

  // Step 2: Build reasoning context from MatchResult
  const visit: VisitContext = {
    id: matchResult.visit_id,
    start_at: DEFAULT_VISIT_START,
    end_at: DEFAULT_VISIT_END,
    status: "scheduled",
  };

  const client: ClientContext | null = matchResult.client_id != null
    ? {
        first_name: "Test",
        last_name: "Client",
        city: "Melbourne",
        state: "VIC",
      }
    : null;

  const context: ReasoningContext = {
    urgency: scenario.preset === "urgent" ? "urgent" : "planned",
  };

  // Step 3: Call reasoning service
  try {
    const recommendation = await getRecommendation({
      visit,
      client,
      matchResult,
      context,
    });

    return {
      scenario_id: scenario.id,
      classification: baseline.classification,
      match_result: matchResult,
      recommendation,
      baseline,
    };
  } catch (error) {
    return {
      scenario_id: scenario.id,
      classification: baseline.classification,
      match_result: matchResult,
      recommendation: null,
      baseline,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
