import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/src/lib/alayacare-client", () => ({
  alayaFetch: vi.fn(),
}));

import { buildRecommendationContext } from "@/src/services/recommendation-context";
import { alayaFetch } from "@/src/lib/alayacare-client";
import type { MatchResult } from "@/src/services/scoring/types";

const mockMatchResult: MatchResult = {
  visit_id: 100,
  client_id: 10,
  candidates: [],
  weights_used: { skills: 0.3, relationship: 0.25, proximity: 0.2, workload: 0.15, acceptance: 0.1 },
  preset_name: "urgent",
  candidate_pool_size: 20,
  eligible_pool_size: 15,
  data_warnings: ["Missing GPS coordinates"],
  match_confidence: "high",
  scored_at: new Date().toISOString(),
};

describe("buildRecommendationContext — enrichment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should include urgency in context", async () => {
    vi.mocked(alayaFetch)
      .mockResolvedValueOnce({ id: 100, client_id: 10, start_at: "2026-03-12T08:00:00Z", end_at: "2026-03-12T12:00:00Z", status: "vacated" })
      .mockResolvedValueOnce({ id: 10, first_name: "John", last_name: "Doe" });

    const result = await buildRecommendationContext(100, mockMatchResult, "urgent");

    expect(result.context.urgency).toBe("urgent");
  });

  it("should include data warnings in context", async () => {
    vi.mocked(alayaFetch)
      .mockResolvedValueOnce({ id: 100, client_id: 10, start_at: "2026-03-12T08:00:00Z", end_at: "2026-03-12T12:00:00Z", status: "vacated" })
      .mockResolvedValueOnce({ id: 10, first_name: "John", last_name: "Doe" });

    const result = await buildRecommendationContext(100, mockMatchResult, "planned");

    expect(result.context.dataWarnings).toContain("Missing GPS coordinates");
  });

  it("should include task history when provided", async () => {
    vi.mocked(alayaFetch)
      .mockResolvedValueOnce({ id: 100, client_id: 10, start_at: "2026-03-12T08:00:00Z", end_at: "2026-03-12T12:00:00Z", status: "vacated" })
      .mockResolvedValueOnce({ id: 10, first_name: "John", last_name: "Doe" });

    const result = await buildRecommendationContext(100, mockMatchResult, "urgent", {
      previousAttempts: 2,
      previousDeclineReasons: ["Too far", "Unavailable"],
    });

    expect(result.context.taskHistory).toEqual({
      previousAttempts: 2,
      previousDeclineReasons: ["Too far", "Unavailable"],
    });
  });
});
