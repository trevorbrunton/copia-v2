import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Mock auth
vi.mock("@/src/server/require-auth-context", () => ({
  requireAuthContext: vi.fn().mockResolvedValue({
    principalId: "user-1",
    supabaseId: "sb-1",
    email: "test@test.com",
    roles: ["authenticated"],
    traceId: "trace-1",
  }),
}));

// Mock computeMatch
const mockComputeMatch = vi.fn();
vi.mock("@/src/services/scoring", () => ({
  computeMatch: (...args: unknown[]) => mockComputeMatch(...args),
}));

// Mock alayaFetch — needed for the availability endpoint to find a visit
const mockAlayaFetch = vi.fn();
vi.mock("@/src/lib/alayacare-client", () => ({
  alayaFetch: (...args: unknown[]) => mockAlayaFetch(...args),
}));

describe("POST /api/v1/availability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return match results for a valid availability query", async () => {
    const mockResult = {
      visit_id: 100,
      client_id: 5,
      candidates: [],
      weights_used: { skills: 0.3, relationship: 0.25, proximity: 0.2, workload: 0.15, acceptance: 0.1 },
      preset_name: "planned",
      candidate_pool_size: 10,
      eligible_pool_size: 5,
      data_warnings: [],
      match_confidence: "high",
      scored_at: "2026-03-11T00:00:00.000Z",
    };

    // Mock finding visits for the client on the given date
    mockAlayaFetch.mockResolvedValueOnce({
      items: [{ id: 100, client_id: 5, start_at: "2026-03-15T09:00:00Z", end_at: "2026-03-15T11:00:00Z" }],
      count: 1,
      page: 1,
      total_pages: 1,
    });
    mockComputeMatch.mockResolvedValueOnce(mockResult);

    const { POST } = await import("@/app/api/v1/availability/route");
    const req = new NextRequest("http://localhost/api/v1/availability", {
      method: "POST",
      body: JSON.stringify({
        client_id: 5,
        date: "2026-03-15",
        required_skill_ids: [1, 2],
      }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.candidates).toBeDefined();
  });

  it("should return 400 for missing client_id", async () => {
    const { POST } = await import("@/app/api/v1/availability/route");
    const req = new NextRequest("http://localhost/api/v1/availability", {
      method: "POST",
      body: JSON.stringify({ date: "2026-03-15" }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("should return 400 for missing date", async () => {
    const { POST } = await import("@/app/api/v1/availability/route");
    const req = new NextRequest("http://localhost/api/v1/availability", {
      method: "POST",
      body: JSON.stringify({ client_id: 5 }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("should return 404 when no visits found for client on date", async () => {
    mockAlayaFetch.mockResolvedValueOnce({
      items: [],
      count: 0,
      page: 1,
      total_pages: 0,
    });

    const { POST } = await import("@/app/api/v1/availability/route");
    const req = new NextRequest("http://localhost/api/v1/availability", {
      method: "POST",
      body: JSON.stringify({ client_id: 5, date: "2026-03-15" }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await POST(req);
    expect(res.status).toBe(404);
  });

  it("should pass preset to computeMatch", async () => {
    mockAlayaFetch.mockResolvedValueOnce({
      items: [{ id: 100, client_id: 5, start_at: "2026-03-15T09:00:00Z", end_at: "2026-03-15T11:00:00Z" }],
      count: 1,
      page: 1,
      total_pages: 1,
    });
    mockComputeMatch.mockResolvedValueOnce({
      visit_id: 100,
      client_id: 5,
      candidates: [],
      weights_used: {},
      preset_name: "urgent",
      candidate_pool_size: 0,
      eligible_pool_size: 0,
      data_warnings: [],
      match_confidence: "low",
      scored_at: "2026-03-11T00:00:00.000Z",
    });

    const { POST } = await import("@/app/api/v1/availability/route");
    const req = new NextRequest("http://localhost/api/v1/availability", {
      method: "POST",
      body: JSON.stringify({ client_id: 5, date: "2026-03-15", preset: "urgent" }),
      headers: { "Content-Type": "application/json" },
    });

    await POST(req);
    expect(mockComputeMatch).toHaveBeenCalledWith(100, { preset: "urgent" });
  });

  it("should handle invalid JSON body", async () => {
    const { POST } = await import("@/app/api/v1/availability/route");
    const req = new NextRequest("http://localhost/api/v1/availability", {
      method: "POST",
      body: "not-json",
      headers: { "Content-Type": "application/json" },
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("should map AlayaCare errors to 502", async () => {
    mockAlayaFetch.mockRejectedValueOnce(new Error("AlayaCare API error: 500 Internal Server Error"));

    const { POST } = await import("@/app/api/v1/availability/route");
    const req = new NextRequest("http://localhost/api/v1/availability", {
      method: "POST",
      body: JSON.stringify({ client_id: 5, date: "2026-03-15" }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await POST(req);
    expect(res.status).toBe(502);
  });
});
