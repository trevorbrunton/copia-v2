import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Mock auth for all endpoints
vi.mock("@/src/server/require-auth-context", () => ({
  requireAuthContext: vi.fn().mockResolvedValue({
    principalId: "user-1",
    supabaseId: "sb-1",
    email: "test@test.com",
    roles: ["authenticated"],
    traceId: "trace-1",
  }),
}));

// Mock computeMatch for match endpoint
const mockComputeMatch = vi.fn();
vi.mock("@/src/services/scoring", () => ({
  computeMatch: (...args: unknown[]) => mockComputeMatch(...args),
}));

// Mock alayaFetch for offers endpoint
const mockAlayaFetch = vi.fn();
vi.mock("@/src/lib/alayacare-client", () => ({
  alayaFetch: (...args: unknown[]) => mockAlayaFetch(...args),
  AlayaPaginatedResponse: {},
}));

describe("Assignment Workflow: match → select → assign", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should complete the full assignment workflow: score → select top candidate → create offer", async () => {
    // Step 1: Get match results for visit 42
    const matchResult = {
      visit_id: 42,
      client_id: 5,
      candidates: [
        {
          employee_id: 101,
          employee_name: "Alice Johnson",
          overall: 0.92,
          confidence: "high",
          dimensions: {
            skills: { score: 1.0, confidence: "high", reason: "All skills matched" },
            relationship: { score: 0.8, confidence: "high", reason: "5 prior visits" },
            proximity: { score: 0.9, confidence: "high", reason: "3.2km away" },
            workload: { score: 0.85, confidence: "high", reason: "Below average load" },
            acceptance: { score: 0.95, confidence: "high", reason: "19/20 accepted" },
          },
          warnings: [],
        },
        {
          employee_id: 102,
          employee_name: "Bob Smith",
          overall: 0.78,
          confidence: "medium",
          dimensions: {
            skills: { score: 0.8, confidence: "high", reason: "Most skills matched" },
            relationship: { score: 0.5, confidence: "medium", reason: "2 prior visits" },
            proximity: { score: 0.7, confidence: "high", reason: "8.1km away" },
            workload: { score: 0.9, confidence: "high", reason: "Light load" },
            acceptance: { score: 0.6, confidence: "medium", reason: "3/5 accepted" },
          },
          warnings: [],
        },
      ],
      weights_used: { skills: 0.3, relationship: 0.25, proximity: 0.2, workload: 0.15, acceptance: 0.1 },
      preset_name: "planned",
      candidate_pool_size: 20,
      eligible_pool_size: 15,
      data_warnings: [],
      match_confidence: "high",
      scored_at: "2026-03-11T00:00:00.000Z",
    };

    mockComputeMatch.mockResolvedValueOnce(matchResult);

    const { POST: matchPOST } = await import("@/app/api/v1/visits/[id]/match/route");
    const matchReq = new NextRequest("http://localhost/api/v1/visits/42/match", {
      method: "POST",
      body: JSON.stringify({ preset: "planned" }),
      headers: { "Content-Type": "application/json" },
    });

    const matchRes = await matchPOST(matchReq, {
      params: Promise.resolve({ id: "42" }),
    });
    expect(matchRes.status).toBe(200);

    const matchBody = await matchRes.json();
    expect(matchBody.candidates).toHaveLength(2);
    expect(matchBody.candidates[0].employee_id).toBe(101);
    expect(matchBody.candidates[0].overall).toBeGreaterThan(matchBody.candidates[1].overall);

    // Step 2: Select top candidate (employee 101)
    const topCandidate = matchBody.candidates[0];
    expect(topCandidate.employee_id).toBe(101);
    expect(topCandidate.confidence).toBe("high");

    // Step 3: Create offer for the top candidate
    const offerResponse = {
      id: 999,
      visit_id: 42,
      employee_id: 101,
      status: "pending",
      offered_at: "2026-03-11T00:00:00.000Z",
    };
    mockAlayaFetch.mockResolvedValueOnce(offerResponse);

    const { POST: offerPOST } = await import("@/app/api/v1/visits/[id]/offers/route");
    const offerReq = new NextRequest("http://localhost/api/v1/visits/42/offers", {
      method: "POST",
      body: JSON.stringify({ employee_id: topCandidate.employee_id }),
      headers: { "Content-Type": "application/json" },
    });

    const offerRes = await offerPOST(offerReq, {
      params: Promise.resolve({ id: "42" }),
    });
    expect(offerRes.status).toBe(201);

    const offerBody = await offerRes.json();
    expect(offerBody.employee_id).toBe(101);
    expect(offerBody.visit_id).toBe(42);
    expect(offerBody.status).toBe("pending");

    // Verify alayaFetch was called with correct offer payload
    expect(mockAlayaFetch).toHaveBeenCalledWith(
      "/scheduler/visits/42/offers",
      { method: "POST", body: { employee_id: 101 } }
    );
  });

  it("should handle assignment failure gracefully (AlayaCare rejects offer)", async () => {
    mockAlayaFetch.mockRejectedValueOnce(
      new Error("AlayaCare API error: 409 Conflict")
    );

    const { POST: offerPOST } = await import("@/app/api/v1/visits/[id]/offers/route");
    const offerReq = new NextRequest("http://localhost/api/v1/visits/42/offers", {
      method: "POST",
      body: JSON.stringify({ employee_id: 101 }),
      headers: { "Content-Type": "application/json" },
    });

    const offerRes = await offerPOST(offerReq, {
      params: Promise.resolve({ id: "42" }),
    });

    // AlayaCare errors map to 502 via handleAppError
    expect(offerRes.status).toBe(502);
  });

  it("should support cascading to second candidate when first is rejected", async () => {
    // First offer rejected by AlayaCare
    mockAlayaFetch.mockRejectedValueOnce(
      new Error("AlayaCare API error: 409 Conflict")
    );

    const { POST: offerPOST } = await import("@/app/api/v1/visits/[id]/offers/route");

    // Attempt first candidate
    const firstReq = new NextRequest("http://localhost/api/v1/visits/42/offers", {
      method: "POST",
      body: JSON.stringify({ employee_id: 101 }),
      headers: { "Content-Type": "application/json" },
    });
    const firstRes = await offerPOST(firstReq, {
      params: Promise.resolve({ id: "42" }),
    });
    expect(firstRes.status).toBe(502);

    // Cascade to second candidate
    const secondOfferResponse = {
      id: 1000,
      visit_id: 42,
      employee_id: 102,
      status: "pending",
      offered_at: "2026-03-11T00:01:00.000Z",
    };
    mockAlayaFetch.mockResolvedValueOnce(secondOfferResponse);

    const secondReq = new NextRequest("http://localhost/api/v1/visits/42/offers", {
      method: "POST",
      body: JSON.stringify({ employee_id: 102 }),
      headers: { "Content-Type": "application/json" },
    });
    const secondRes = await offerPOST(secondReq, {
      params: Promise.resolve({ id: "42" }),
    });
    expect(secondRes.status).toBe(201);

    const body = await secondRes.json();
    expect(body.employee_id).toBe(102);
  });
});
