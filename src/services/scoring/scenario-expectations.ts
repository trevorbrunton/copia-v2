/**
 * Scenario expectations for the 32 scoring scenarios.
 * Shared between the scenario tests and comparison report.
 */

export interface ScenarioExpectation {
  id: string;
  category: string;
  name: string;
  expectedTopEmployee?: number;
  expectedConfidence?: "high" | "medium" | "low";
  expectedEligible?: number;
  minTopScore?: number;
  maxTopScore?: number;
}

export const SCENARIO_EXPECTATIONS: ScenarioExpectation[] = [
  { id: "S1", category: "Straightforward", name: "Clear winner", expectedTopEmployee: 1, minTopScore: 0.7 },
  { id: "S2", category: "Straightforward", name: "Tight race" },
  { id: "S3", category: "Straightforward", name: "Workload differentiator" },
  { id: "S4", category: "Straightforward", name: "Single candidate", expectedConfidence: "low", expectedEligible: 1 },
  { id: "S5", category: "Straightforward", name: "Large pool with limit" },
  { id: "M1", category: "Multi-Qualified", name: "All fully qualified" },
  { id: "M2", category: "Multi-Qualified", name: "Partial skills filtered", expectedEligible: 1 },
  { id: "M3", category: "Multi-Qualified", name: "No required skills — low confidence" },
  { id: "M4", category: "Multi-Qualified", name: "Expiring-soon still valid", expectedEligible: 3 },
  { id: "M5", category: "Multi-Qualified", name: "5 requirements — only fully qualified pass", expectedEligible: 2 },
  { id: "R1", category: "Rural/Sparse", name: "All beyond 50km" },
  { id: "R2", category: "Rural/Sparse", name: "Only 2 candidates", expectedConfidence: "low" },
  { id: "R3", category: "Rural/Sparse", name: "Proximity differentiates" },
  { id: "R4", category: "Rural/Sparse", name: "Null coordinates" },
  { id: "R5", category: "Rural/Sparse", name: "Client missing coordinates" },
  { id: "P1", category: "Preset Comparison", name: "Urgent — acceptance wins", expectedTopEmployee: 1 },
  { id: "P2", category: "Preset Comparison", name: "Planned — relationship wins", expectedTopEmployee: 2 },
  { id: "P3", category: "Preset Comparison", name: "Efficiency — proximity+workload wins", expectedTopEmployee: 1 },
  { id: "P4", category: "Preset Comparison", name: "High-value — relationship dominates", expectedTopEmployee: 1 },
  { id: "P5", category: "Preset Comparison", name: "New-client — skills weighted" },
  { id: "P6", category: "Preset Comparison", name: "Custom 100% skills weight" },
  { id: "N1", category: "Client Relationship", name: "Brand new client — zero relationship" },
  { id: "N2", category: "Client Relationship", name: "Established client — continuity favoured", expectedTopEmployee: 1 },
  { id: "N3", category: "Client Relationship", name: "Stale vs recent relationship" },
  { id: "N4", category: "Client Relationship", name: "No client assigned" },
  { id: "N5", category: "Client Relationship", name: "Confidence tiers" },
  { id: "H1", category: "Hard Constraints", name: "All filtered — empty result", expectedEligible: 0, expectedConfidence: "low" },
  { id: "H2", category: "Hard Constraints", name: "Schedule conflict filters employee" },
  { id: "H3", category: "Hard Constraints", name: "Adjacent shifts — no conflict", expectedEligible: 3 },
  { id: "H4", category: "Hard Constraints", name: "Expired skill filters employee" },
  { id: "H5", category: "Hard Constraints", name: "Multiple constraint failures" },
  { id: "H6", category: "Hard Constraints", name: "No required skills — all eligible", expectedEligible: 3 },
];
