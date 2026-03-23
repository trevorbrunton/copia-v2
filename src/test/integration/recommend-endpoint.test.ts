import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Mock auth
vi.mock("@/src/server/require-auth-context", () => ({
  requireAuthContext: vi.fn().mockResolvedValue({
    principalId: "user-1",
    supabaseId: "sub-1",
    email: "test@example.com",
    roles: [],
    traceId: "test-trace",
  }),
}));

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

// Mock alayaFetch for visit/client detail
const mockAlayaFetch = vi.fn();
vi.mock("@/src/lib/alayacare-client", () => ({
  alayaFetch: (...args: unknown[]) => mockAlayaFetch(...args),
}));

import { POST } from "@/app/api/v1/visits/[id]/recommend/route";

function makeRequest(visitId: number, body: unknown): NextRequest {
  return new NextRequest(
    new URL(`http://localhost:3000/api/v1/visits/${visitId}/recommend`),
    {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }
  );
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
        skills: { score: 1.0, confidence: "high", reason: "All skills matched" },
        relationship: { score: 0.7, confidence: "medium", reason: "5 visits" },
        proximity: { score: 0.9, confidence: "high", reason: "5km" },
        workload: { score: 0.8, confidence: "high", reason: "Normal" },
        acceptance: { score: 0.75, confidence: "medium", reason: "75% rate" },
      },
      warnings: [],
    },
  ],
  weights_used: { skills: 0.2, relationship: 0.3, proximity: 0.15, workload: 0.2, acceptance: 0.15 },
  preset_name: "planned",
  candidate_pool_size: 5,
  eligible_pool_size: 3,
  data_warnings: [],
  match_confidence: "high",
  scored_at: "2026-03-15T08:00:00Z",
};

const minimalRecommendation = {
  primary: {
    employee_id: 1,
    employee_name: "Alice Smith",
    explanation: "Alice is the best match due to strong skills and proximity.",
    confidence: "high",
  },
  escalation: {
    should_escalate: false,
    reason: null,
    urgency: "informational",
  },
  factors_considered: ["skills", "proximity", "relationship"],
  trade_offs: ["slightly higher workload than average"],
  model: "au.anthropic.claude-haiku-4-5-20251001-v1:0",
  usage: { inputTokens: 500, outputTokens: 200 },
};

beforeEach(() => {
  vi.clearAllMocks();

  // Default: visit detail returns start/end/status
  mockAlayaFetch.mockImplementation((url: string) => {
    if (url.includes("/scheduler/visits/")) {
      return Promise.resolve({
        id: 42,
        client_id: 10,
        start_at: "2026-03-15T09:00:00Z",
        end_at: "2026-03-15T11:00:00Z",
        status: "scheduled",
        service_instructions: "Handle with care",
      });
    }
    if (url.includes("/patients/clients/")) {
      return Promise.resolve({
        id: 10,
        first_name: "Jane",
        last_name: "Doe",
        city: "Melbourne",
        state: "VIC",
      });
    }
    return Promise.resolve({});
  });

  mockComputeMatch.mockResolvedValue(minimalMatchResult);
  mockGetRecommendation.mockResolvedValue(minimalRecommendation);
});

describe("POST /api/v1/visits/[id]/recommend", () => {
  it("should return recommendation with match result", async () => {
    const req = makeRequest(42, { preset: "planned" });
    const res = await POST(req, { params: Promise.resolve({ id: "42" }) });

    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.match_result).toBeDefined();
    expect(data.recommendation).toBeDefined();
    expect(data.recommendation.primary.employee_id).toBe(1);
    expect(data.recommendation.escalation.should_escalate).toBe(false);
  });

  it("should pass preset to computeMatch", async () => {
    const req = makeRequest(42, { preset: "urgent" });
    await POST(req, { params: Promise.resolve({ id: "42" }) });

    expect(mockComputeMatch).toHaveBeenCalledWith(42, { preset: "urgent" });
  });

  it("should pass visit and client context to getRecommendation", async () => {
    const req = makeRequest(42, { preset: "planned" });
    await POST(req, { params: Promise.resolve({ id: "42" }) });

    expect(mockGetRecommendation).toHaveBeenCalledOnce();
    const opts = mockGetRecommendation.mock.calls[0][0];

    expect(opts.visit.id).toBe(42);
    expect(opts.visit.start_at).toBe("2026-03-15T09:00:00Z");
    expect(opts.client.first_name).toBe("Jane");
    expect(opts.matchResult).toEqual(minimalMatchResult);
    expect(opts.context.urgency).toBe("planned");
  });

  it("should handle urgent preset as urgent context", async () => {
    const req = makeRequest(42, { preset: "urgent" });
    await POST(req, { params: Promise.resolve({ id: "42" }) });

    const opts = mockGetRecommendation.mock.calls[0][0];
    expect(opts.context.urgency).toBe("urgent");
  });

  it("should handle null client_id gracefully", async () => {
    mockComputeMatch.mockResolvedValue({ ...minimalMatchResult, client_id: null });

    const req = makeRequest(42, { preset: "planned" });
    const res = await POST(req, { params: Promise.resolve({ id: "42" }) });

    expect(res.status).toBe(200);
    const opts = mockGetRecommendation.mock.calls[0][0];
    expect(opts.client).toBeNull();
  });

  it("should return 400 for invalid visit ID", async () => {
    const req = makeRequest(-1, { preset: "planned" });
    const res = await POST(req, { params: Promise.resolve({ id: "-1" }) });

    expect(res.status).toBe(400);
  });

  it("should return error when LLM fails", async () => {
    mockGetRecommendation.mockRejectedValue(new Error("LLM response parse error: invalid JSON"));

    const req = makeRequest(42, { preset: "planned" });
    const res = await POST(req, { params: Promise.resolve({ id: "42" }) });

    expect(res.status).toBe(502);
    const data = await res.json();
    expect(data.error.code).toBe("EXTERNAL_SERVICE_ERROR");
  });

  it("should accept custom weights instead of preset", async () => {
    const weights = { skills: 0.2, relationship: 0.2, proximity: 0.2, workload: 0.2, acceptance: 0.2 };
    const req = makeRequest(42, { weights });
    await POST(req, { params: Promise.resolve({ id: "42" }) });

    expect(mockComputeMatch).toHaveBeenCalledWith(42, { weights });
  });

  it("should reject both weights and preset", async () => {
    const req = makeRequest(42, {
      preset: "planned",
      weights: { skills: 0.2, relationship: 0.2, proximity: 0.2, workload: 0.2, acceptance: 0.2 },
    });
    const res = await POST(req, { params: Promise.resolve({ id: "42" }) });

    expect(res.status).toBe(400);
  });

  it("should return 502 when alayaFetch fails for visit detail", async () => {
    mockAlayaFetch.mockRejectedValue(new Error("AlayaCare API timeout"));

    const req = makeRequest(42, { preset: "planned" });
    const res = await POST(req, { params: Promise.resolve({ id: "42" }) });

    expect(res.status).toBe(502);
    const data = await res.json();
    expect(data.error.code).toBe("EXTERNAL_SERVICE_ERROR");
  });
});
