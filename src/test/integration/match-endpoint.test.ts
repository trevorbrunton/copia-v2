import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/v1/visits/[id]/match/route";

// Mock auth — resolve to a valid AuthContext
vi.mock("@/src/server/require-auth-context", () => ({
  requireAuthContext: vi.fn().mockResolvedValue({
    principalId: "user-1",
    supabaseId: "sub-1",
    email: "test@example.com",
    roles: [],
    traceId: "test-trace",
  }),
}));

// Mock computeMatch — returns a minimal MatchResult
const mockComputeMatch = vi.fn();
vi.mock("@/src/services/scoring", () => ({
  computeMatch: (...args: unknown[]) => mockComputeMatch(...args),
  WEIGHT_PRESETS: {
    planned: { skills: 0.2, relationship: 0.3, proximity: 0.15, workload: 0.2, acceptance: 0.15 },
    urgent: { skills: 0.15, relationship: 0.1, proximity: 0.25, workload: 0.1, acceptance: 0.4 },
    high_value_client: { skills: 0.15, relationship: 0.35, proximity: 0.15, workload: 0.1, acceptance: 0.25 },
    new_client: { skills: 0.25, relationship: 0.05, proximity: 0.2, workload: 0.25, acceptance: 0.25 },
    efficiency: { skills: 0.15, relationship: 0.1, proximity: 0.3, workload: 0.3, acceptance: 0.15 },
  },
}));

function makeRequest(
  visitId: number,
  body: unknown,
  method = "POST"
): NextRequest {
  return new NextRequest(
    new URL(`http://localhost:3000/api/v1/visits/${visitId}/match`),
    {
      method,
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }
  );
}

const minimalMatchResult = {
  visit_id: 42,
  client_id: 1,
  candidates: [],
  weights_used: { skills: 0.2, relationship: 0.3, proximity: 0.15, workload: 0.2, acceptance: 0.15 },
  preset_name: "planned",
  candidate_pool_size: 5,
  eligible_pool_size: 3,
  data_warnings: [],
  match_confidence: "low",
  scored_at: "2026-03-11T00:00:00.000Z",
};

describe("POST /api/v1/visits/[id]/match", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockComputeMatch.mockResolvedValue(minimalMatchResult);
  });

  it("returns MatchResult shape with default preset", async () => {
    const req = makeRequest(42, {});
    const res = await POST(req, { params: Promise.resolve({ id: "42" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.visit_id).toBe(42);
    expect(body.match_confidence).toBeDefined();
    expect(mockComputeMatch).toHaveBeenCalledWith(42, {});
  });

  it("passes preset to computeMatch", async () => {
    const req = makeRequest(42, { preset: "urgent" });
    const res = await POST(req, { params: Promise.resolve({ id: "42" }) });
    expect(res.status).toBe(200);
    expect(mockComputeMatch).toHaveBeenCalledWith(42, { preset: "urgent" });
  });

  it("passes custom weights to computeMatch", async () => {
    const weights = { skills: 0.2, relationship: 0.2, proximity: 0.2, workload: 0.2, acceptance: 0.2 };
    const req = makeRequest(42, { weights });
    const res = await POST(req, { params: Promise.resolve({ id: "42" }) });
    expect(res.status).toBe(200);
    expect(mockComputeMatch).toHaveBeenCalledWith(42, { weights });
  });

  it("passes limit to computeMatch", async () => {
    const req = makeRequest(42, { limit: 5 });
    const res = await POST(req, { params: Promise.resolve({ id: "42" }) });
    expect(res.status).toBe(200);
    expect(mockComputeMatch).toHaveBeenCalledWith(42, { limit: 5 });
  });

  it("rejects non-numeric visit ID with 400", async () => {
    const req = makeRequest(42, {});
    const res = await POST(req, { params: Promise.resolve({ id: "abc" }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects invalid preset with 400", async () => {
    const req = makeRequest(42, { preset: "nonexistent" });
    const res = await POST(req, { params: Promise.resolve({ id: "42" }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects weights that don't sum to 1.0 with 400", async () => {
    const weights = { skills: 0.5, relationship: 0.5, proximity: 0.5, workload: 0.5, acceptance: 0.5 };
    const req = makeRequest(42, { weights });
    const res = await POST(req, { params: Promise.resolve({ id: "42" }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects both weights and preset with 400", async () => {
    const weights = { skills: 0.2, relationship: 0.2, proximity: 0.2, workload: 0.2, acceptance: 0.2 };
    const req = makeRequest(42, { weights, preset: "urgent" });
    const res = await POST(req, { params: Promise.resolve({ id: "42" }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects limit outside range with 400", async () => {
    const req = makeRequest(42, { limit: 0 });
    const res = await POST(req, { params: Promise.resolve({ id: "42" }) });
    expect(res.status).toBe(400);
  });

  it("rejects invalid JSON body with 400", async () => {
    const req = new NextRequest(
      new URL("http://localhost:3000/api/v1/visits/42/match"),
      {
        method: "POST",
        body: "not json",
        headers: { "Content-Type": "application/json" },
      }
    );
    const res = await POST(req, { params: Promise.resolve({ id: "42" }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toBe("Invalid JSON body");
  });

  it("maps AlayaCare errors to 502", async () => {
    mockComputeMatch.mockRejectedValue(
      new Error("AlayaCare API error: 500 Internal Server Error")
    );
    const req = makeRequest(42, {});
    const res = await POST(req, { params: Promise.resolve({ id: "42" }) });
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error.code).toBe("EXTERNAL_SERVICE_ERROR");
  });

  it("maps unknown errors to 500", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockComputeMatch.mockRejectedValue(new Error("unexpected"));
    const req = makeRequest(42, {});
    const res = await POST(req, { params: Promise.resolve({ id: "42" }) });
    expect(res.status).toBe(500);
    vi.restoreAllMocks();
  });
});
