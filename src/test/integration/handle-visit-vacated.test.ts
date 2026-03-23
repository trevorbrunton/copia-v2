import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AlayaCareEvent } from "@/src/lib/alayacare-events/types";

// Mock computeMatch
const mockComputeMatch = vi.fn();
vi.mock("@/src/services/scoring", () => ({
  computeMatch: (...args: unknown[]) => mockComputeMatch(...args),
}));

// Mock getRecommendation
const mockGetRecommendation = vi.fn();
vi.mock("@/src/services/reasoning", () => ({
  getRecommendation: (...args: unknown[]) => mockGetRecommendation(...args),
}));

// Mock buildRecommendationContext (shared helper)
const mockBuildContext = vi.fn();
vi.mock("@/src/services/recommendation-context", () => ({
  buildRecommendationContext: (...args: unknown[]) => mockBuildContext(...args),
}));

import { handleVisitVacated } from "@/src/server/commands/webhooks/handle-visit-vacated";

function makeEvent(payload?: Record<string, unknown>): AlayaCareEvent {
  return {
    event_id: "evt-001",
    event_type: "visit.vacated",
    timestamp: "2026-03-11T10:00:00Z",
    payload: { visit_id: 42, client_id: 10, ...payload },
    metadata: { source: "simulation", trace_id: "sim-trace-001" },
  };
}

const minimalMatchResult = {
  visit_id: 42,
  client_id: 10,
  candidates: [
    {
      employee_id: 1,
      employee_name: "Alice Smith",
      overall: 0.85,
      confidence: "high",
      dimensions: {
        skills: { score: 1.0, confidence: "high", reason: "All matched" },
        relationship: { score: 0.7, confidence: "medium", reason: "5 visits" },
        proximity: { score: 0.9, confidence: "high", reason: "5km" },
        workload: { score: 0.8, confidence: "high", reason: "Normal" },
        acceptance: { score: 0.75, confidence: "medium", reason: "75%" },
      },
      warnings: [],
    },
    {
      employee_id: 2,
      employee_name: "Bob Jones",
      overall: 0.72,
      confidence: "medium",
      dimensions: {
        skills: { score: 0.8, confidence: "high", reason: "Most matched" },
        relationship: { score: 0.5, confidence: "low", reason: "2 visits" },
        proximity: { score: 0.9, confidence: "high", reason: "3km" },
        workload: { score: 0.6, confidence: "medium", reason: "Busy" },
        acceptance: { score: 0.8, confidence: "high", reason: "80%" },
      },
      warnings: [],
    },
  ],
  weights_used: {
    skills: 0.3,
    relationship: 0.2,
    proximity: 0.2,
    workload: 0.15,
    acceptance: 0.15,
  },
  preset_name: "urgent",
  candidate_pool_size: 20,
  eligible_pool_size: 15,
  data_warnings: [],
  match_confidence: "high" as const,
  scored_at: "2026-03-11T10:00:01Z",
};

const minimalRecommendation = {
  primary: {
    employee_id: 1,
    employee_name: "Alice Smith",
    explanation: "Best overall match for this visit",
    confidence: "high" as const,
  },
  escalation: {
    should_escalate: false,
    reason: null,
    urgency: "informational" as const,
  },
  factors_considered: ["skills match", "proximity", "workload"],
  trade_offs: ["Bob Jones also suitable but lower overall score"],
  model: "haiku-4.5",
  usage: { inputTokens: 500, outputTokens: 200 },
};

const mockContextResult = {
  visit: {
    id: 42,
    start_at: "2026-03-12T08:00:00Z",
    end_at: "2026-03-12T10:00:00Z",
    status: "vacated",
    service_instructions: "Needs assistance with mobility",
  },
  client: {
    first_name: "Jane",
    last_name: "Doe",
    city: "Sydney",
    state: "NSW",
  },
  context: { urgency: "urgent" as const },
};

describe("handleVisitVacated", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockComputeMatch.mockResolvedValue(minimalMatchResult);
    mockBuildContext.mockResolvedValue(mockContextResult);
    mockGetRecommendation.mockResolvedValue(minimalRecommendation);
  });

  it("calls computeMatch with visit_id and urgent preset", async () => {
    await handleVisitVacated(makeEvent(), "trace-1");
    expect(mockComputeMatch).toHaveBeenCalledWith(42, { preset: "urgent" });
  });

  it("calls buildRecommendationContext with correct args", async () => {
    await handleVisitVacated(makeEvent(), "trace-1");

    expect(mockBuildContext).toHaveBeenCalledWith(42, minimalMatchResult, "urgent");
  });

  it("calls getRecommendation with context from shared helper", async () => {
    await handleVisitVacated(makeEvent(), "trace-1");

    expect(mockGetRecommendation).toHaveBeenCalledOnce();
    const opts = mockGetRecommendation.mock.calls[0][0];
    expect(opts.visit).toBe(mockContextResult.visit);
    expect(opts.client).toBe(mockContextResult.client);
    expect(opts.context).toBe(mockContextResult.context);
    expect(opts.matchResult).toBe(minimalMatchResult);
  });

  it("returns result with correct shape", async () => {
    const result = await handleVisitVacated(makeEvent(), "trace-1");

    expect(result).toEqual({
      visit_id: 42,
      match_confidence: "high",
      top_candidates: [
        { employee_id: 1, employee_name: "Alice Smith", overall_score: 0.85 },
        { employee_id: 2, employee_name: "Bob Jones", overall_score: 0.72 },
      ],
      recommendation: {
        primary: minimalRecommendation.primary,
        escalation: minimalRecommendation.escalation,
        factors_considered: minimalRecommendation.factors_considered,
      },
    });
  });

  it("validates visit_id is a positive integer", async () => {
    await expect(
      handleVisitVacated(makeEvent({ visit_id: "abc" }), "trace-1")
    ).rejects.toThrow("visit_id must be a positive integer");

    await expect(
      handleVisitVacated(makeEvent({ visit_id: -1 }), "trace-1")
    ).rejects.toThrow("visit_id must be a positive integer");
  });

  it("throws ExternalServiceError when context building fails", async () => {
    mockBuildContext.mockRejectedValue(new Error("AlayaCare API error: 503"));

    await expect(handleVisitVacated(makeEvent(), "trace-1")).rejects.toThrow(
      "AlayaCare API error: 503"
    );
  });

  it("throws ExternalServiceError when LLM reasoning fails", async () => {
    mockGetRecommendation.mockRejectedValue(new Error("LLM timeout"));

    await expect(handleVisitVacated(makeEvent(), "trace-1")).rejects.toThrow(
      "LLM timeout"
    );
  });
});
