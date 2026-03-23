import { describe, it, expect } from "vitest";
import { formatWeights, formatCandidate, buildReasoningPrompt, ROSTERING_SYSTEM_PROMPT } from "./prompts";
import type { MatchResult, ScoredCandidate, WeightConfig } from "../scoring/types";
import type { VisitContext, ClientContext, ReasoningContext } from "./types";

// ── Test data ──

const weights: WeightConfig = {
  skills: 0.20,
  relationship: 0.30,
  proximity: 0.15,
  workload: 0.20,
  acceptance: 0.15,
};

const candidate: ScoredCandidate = {
  employee_id: 1,
  employee_name: "Alice Smith",
  overall: 0.85,
  confidence: "high",
  dimensions: {
    skills: { score: 1.0, confidence: "high", reason: "All 2 required skills present and valid" },
    relationship: { score: 0.9, confidence: "high", reason: "15 visits in last 7 days" },
    proximity: { score: 0.95, confidence: "high", reason: "2.1km from client" },
    workload: { score: 0.7, confidence: "medium", reason: "1 shift today, below average" },
    acceptance: { score: 0.9, confidence: "high", reason: "18 accepted, 2 declined (90%)" },
  },
  warnings: [],
};

const candidateWithWarnings: ScoredCandidate = {
  ...candidate,
  employee_id: 2,
  employee_name: "Bob Jones",
  warnings: ["Employee missing coordinates"],
};

const visit: VisitContext = {
  id: 100,
  start_at: "2026-03-15T09:00:00Z",
  end_at: "2026-03-15T11:00:00Z",
  status: "scheduled",
  service_instructions: "Assist with morning routine",
};

const client: ClientContext = {
  first_name: "Margaret",
  last_name: "Thompson",
  city: "Melbourne",
  state: "VIC",
  care_needs: "Mobility assistance, medication reminders",
};

const context: ReasoningContext = { urgency: "planned" };

const matchResult: MatchResult = {
  visit_id: 100,
  client_id: 10,
  candidates: [candidate],
  weights_used: weights,
  preset_name: "planned",
  candidate_pool_size: 4,
  eligible_pool_size: 3,
  data_warnings: [],
  match_confidence: "high",
  scored_at: "2026-03-15T08:00:00Z",
};

// ── Tests ──

describe("formatWeights", () => {
  it("should format all 5 dimensions as percentages", () => {
    const result = formatWeights(weights);
    expect(result).toContain("skills: 20%");
    expect(result).toContain("relationship: 30%");
    expect(result).toContain("proximity: 15%");
    expect(result).toContain("workload: 20%");
    expect(result).toContain("acceptance: 15%");
  });
});

describe("formatCandidate", () => {
  it("should include rank, name, and employee ID", () => {
    const result = formatCandidate(candidate, 1);
    expect(result).toContain("Rank 1: Alice Smith (ID: 1)");
  });

  it("should include overall score as percentage", () => {
    const result = formatCandidate(candidate, 1);
    expect(result).toContain("85.0%");
  });

  it("should include confidence level", () => {
    const result = formatCandidate(candidate, 1);
    expect(result).toContain("Confidence: high");
  });

  it("should include all 5 dimension scores with reasons", () => {
    const result = formatCandidate(candidate, 1);
    expect(result).toContain("skills: 100% (high)");
    expect(result).toContain("relationship: 90% (high)");
    expect(result).toContain("proximity: 95% (high)");
    expect(result).toContain("workload: 70% (medium)");
    expect(result).toContain("acceptance: 90% (high)");
    expect(result).toContain("All 2 required skills present and valid");
  });

  it("should include warnings when present", () => {
    const result = formatCandidate(candidateWithWarnings, 2);
    expect(result).toContain("Warnings: Employee missing coordinates");
  });

  it("should not include warnings section when empty", () => {
    const result = formatCandidate(candidate, 1);
    expect(result).not.toContain("Warnings:");
  });
});

describe("buildReasoningPrompt", () => {
  it("should include shift details", () => {
    const prompt = buildReasoningPrompt(visit, client, matchResult, context);
    expect(prompt).toContain("Visit ID: 100");
    expect(prompt).toContain("2026-03-15T09:00:00Z to 2026-03-15T11:00:00Z");
    expect(prompt).toContain("Urgency: planned");
    expect(prompt).toContain("Assist with morning routine");
  });

  it("should include client details", () => {
    const prompt = buildReasoningPrompt(visit, client, matchResult, context);
    expect(prompt).toContain("Margaret Thompson");
    expect(prompt).toContain("Melbourne, VIC");
    expect(prompt).toContain("Mobility assistance");
  });

  it("should handle null client", () => {
    const prompt = buildReasoningPrompt(visit, null, matchResult, context);
    expect(prompt).toContain("No client assigned to this visit");
  });

  it("should include match confidence", () => {
    const prompt = buildReasoningPrompt(visit, client, matchResult, context);
    expect(prompt).toContain("Match Confidence: high");
  });

  it("should include data quality warnings when present", () => {
    const withWarnings = { ...matchResult, data_warnings: ["Client missing coordinates"] };
    const prompt = buildReasoningPrompt(visit, client, withWarnings, context);
    expect(prompt).toContain("- Client missing coordinates");
  });

  it("should show 'None' when no data warnings", () => {
    const prompt = buildReasoningPrompt(visit, client, matchResult, context);
    expect(prompt).toContain("- None");
  });

  it("should include candidate count and pool size", () => {
    const prompt = buildReasoningPrompt(visit, client, matchResult, context);
    expect(prompt).toContain("1 of 4 employees");
  });

  it("should include weight preset name", () => {
    const prompt = buildReasoningPrompt(visit, client, matchResult, context);
    expect(prompt).toContain("Preset: planned");
  });

  it("should show 'custom' for null preset", () => {
    const customWeights = { ...matchResult, preset_name: null };
    const prompt = buildReasoningPrompt(visit, client, customWeights, context);
    expect(prompt).toContain("Preset: custom");
  });

  it("should include formatted candidates", () => {
    const prompt = buildReasoningPrompt(visit, client, matchResult, context);
    expect(prompt).toContain("Rank 1: Alice Smith");
  });

  it("should handle zero candidates gracefully", () => {
    const empty = { ...matchResult, candidates: [] };
    const prompt = buildReasoningPrompt(visit, client, empty, context);
    expect(prompt).toContain("No eligible candidates after hard constraint filtering.");
  });

  it("should handle null service instructions", () => {
    const noInstructions = { ...visit, service_instructions: null };
    const prompt = buildReasoningPrompt(noInstructions, client, matchResult, context);
    expect(prompt).toContain("Instructions: None");
  });

  it("should handle client with missing city/state", () => {
    const partial: ClientContext = { first_name: "John", last_name: "Doe", city: null, state: null };
    const prompt = buildReasoningPrompt(visit, partial, matchResult, context);
    expect(prompt).toContain("Unknown, Unknown");
  });
});

describe("ROSTERING_SYSTEM_PROMPT", () => {
  it("should define the three responsibilities", () => {
    expect(ROSTERING_SYSTEM_PROMPT).toContain("RECOMMEND the best caregiver");
    expect(ROSTERING_SYSTEM_PROMPT).toContain("IDENTIFY if this scenario requires human escalation");
    expect(ROSTERING_SYSTEM_PROMPT).toContain("EXPLAIN your reasoning");
  });

  it("should include escalation criteria", () => {
    expect(ROSTERING_SYSTEM_PROMPT).toContain("ESCALATION CRITERIA");
    expect(ROSTERING_SYSTEM_PROMPT).toContain("Fewer than 3 viable candidates");
    expect(ROSTERING_SYSTEM_PROMPT).toContain("No candidate scores above 0.5");
  });

  it("should include JSON output format", () => {
    expect(ROSTERING_SYSTEM_PROMPT).toContain('"primary"');
    expect(ROSTERING_SYSTEM_PROMPT).toContain('"escalation"');
    expect(ROSTERING_SYSTEM_PROMPT).toContain('"factors_considered"');
    expect(ROSTERING_SYSTEM_PROMPT).toContain('"trade_offs"');
  });

  it("should instruct JSON-only output", () => {
    expect(ROSTERING_SYSTEM_PROMPT).toContain("Respond ONLY with the JSON object");
  });
});
