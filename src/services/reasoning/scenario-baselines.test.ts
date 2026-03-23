import { describe, it, expect } from "vitest";
import { SCENARIO_BASELINES } from "./scenario-baselines";
import { SCENARIO_EXPECTATIONS } from "../scoring/scenario-expectations";

describe("Scenario Baselines", () => {
  it("should have a baseline for every scoring scenario", () => {
    const baselineIds = SCENARIO_BASELINES.map((b) => b.id);
    const expectationIds = SCENARIO_EXPECTATIONS.map((e) => e.id);

    for (const id of expectationIds) {
      expect(baselineIds).toContain(id);
    }
  });

  it("should have exactly 32 baselines", () => {
    expect(SCENARIO_BASELINES).toHaveLength(32);
  });

  it("should have no duplicate IDs", () => {
    const ids = SCENARIO_BASELINES.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("should have valid classifications for all baselines", () => {
    const valid = ["straightforward", "ambiguous", "edge_case", "constraint_violation"];
    for (const baseline of SCENARIO_BASELINES) {
      expect(valid).toContain(baseline.classification);
    }
  });

  it("should have non-empty human_decision for all baselines", () => {
    for (const baseline of SCENARIO_BASELINES) {
      expect(baseline.human_decision.length).toBeGreaterThan(0);
    }
  });

  it("should have non-empty rationale for all baselines", () => {
    for (const baseline of SCENARIO_BASELINES) {
      expect(baseline.rationale.length).toBeGreaterThan(0);
    }
  });

  it("should classify constraint violations as constraint_violation", () => {
    // H1 (all filtered), H2, H4, H5 have constraint failures, M2 and M5 also
    const constraintScenarios = SCENARIO_BASELINES.filter(
      (b) => b.classification === "constraint_violation"
    );
    expect(constraintScenarios.length).toBeGreaterThanOrEqual(5);

    const constraintIds = constraintScenarios.map((b) => b.id);
    expect(constraintIds).toContain("H1");
    expect(constraintIds).toContain("H2");
    expect(constraintIds).toContain("M2");
  });

  it("should flag zero-candidate scenario for escalation", () => {
    const h1 = SCENARIO_BASELINES.find((b) => b.id === "H1");
    expect(h1).toBeDefined();
    expect(h1!.should_escalate).toBe(true);
  });

  it("should flag single-candidate scenario for escalation", () => {
    const s4 = SCENARIO_BASELINES.find((b) => b.id === "S4");
    expect(s4).toBeDefined();
    expect(s4!.should_escalate).toBe(true);
  });

  it("should flag edge cases with missing data for escalation", () => {
    // R4 (null coords), R5 (missing client coords), N4 (no client)
    for (const id of ["R4", "R5", "N4"]) {
      const baseline = SCENARIO_BASELINES.find((b) => b.id === id);
      expect(baseline).toBeDefined();
      expect(baseline!.should_escalate).toBe(true);
    }
  });

  it("should have expected classification distribution", () => {
    const counts = SCENARIO_BASELINES.reduce((acc, b) => {
      acc[b.classification] = (acc[b.classification] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    // Straightforward should be the majority
    expect(counts.straightforward).toBeGreaterThanOrEqual(10);
    // Edge cases should cover data quality scenarios
    expect(counts.edge_case).toBeGreaterThanOrEqual(5);
    // Constraint violations should cover hard filter scenarios
    expect(counts.constraint_violation).toBeGreaterThanOrEqual(4);
    // Ambiguous should be present but fewer
    expect(counts.ambiguous).toBeGreaterThanOrEqual(1);
  });
});
