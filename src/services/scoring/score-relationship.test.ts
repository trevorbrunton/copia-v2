import { describe, it, expect } from "vitest";
import { scoreRelationship } from "./score-relationship";

const now = new Date("2026-03-11T08:00:00Z");

const makeVisit = (daysAgo: number) => ({
  start_at: new Date(
    now.getTime() - daysAgo * 24 * 60 * 60 * 1000
  ).toISOString(),
});

describe("scoreRelationship", () => {
  it("should return 0.0 with low confidence when no prior visits", () => {
    const result = scoreRelationship([], now);

    expect(result.score).toBeCloseTo(0.0);
    expect(result.confidence).toBe("low");
  });

  it("should score 1 recent visit with logarithmic formula", () => {
    const visits = [makeVisit(3)]; // 3 days ago → recency ≤7d → 1.0 multiplier
    const result = scoreRelationship(visits, now);

    // ln(2)/ln(20) ≈ 0.231 × 1.0 = 0.231
    expect(result.score).toBeCloseTo(Math.log(2) / Math.log(20), 2);
    expect(result.confidence).toBe("low");
  });

  it("should score 10 recent visits higher than 1", () => {
    const visits = Array.from({ length: 10 }, () => makeVisit(5));
    const result = scoreRelationship(visits, now);

    // ln(11)/ln(20) ≈ 0.799 × 1.0
    expect(result.score).toBeCloseTo(Math.log(11) / Math.log(20), 2);
  });

  it("should cap at 1.0 for 19+ visits", () => {
    const visits = Array.from({ length: 25 }, () => makeVisit(1));
    const result = scoreRelationship(visits, now);

    // ln(26)/ln(20) ≈ 1.087, capped to 1.0
    expect(result.score).toBeLessThanOrEqual(1.0);
    expect(result.score).toBeCloseTo(1.0, 1);
  });

  it("should apply recency multiplier for stale visits (>90 days)", () => {
    const visits = Array.from({ length: 10 }, () => makeVisit(100));
    const result = scoreRelationship(visits, now);

    // ln(11)/ln(20) ≈ 0.799 × 0.4 (>90d) ≈ 0.320
    const base = Math.log(11) / Math.log(20);
    expect(result.score).toBeCloseTo(base * 0.4, 2);
  });

  it("should use 0.8 multiplier for 8–30 day recency", () => {
    const visits = [makeVisit(15)]; // 15 days ago → ≤30d → 0.8 multiplier
    const result = scoreRelationship(visits, now);

    const base = Math.log(2) / Math.log(20);
    expect(result.score).toBeCloseTo(base * 0.8, 2);
  });

  it("should use 0.6 multiplier for 31–90 day recency", () => {
    const visits = [makeVisit(60)]; // 60 days ago → ≤90d → 0.6 multiplier
    const result = scoreRelationship(visits, now);

    const base = Math.log(2) / Math.log(20);
    expect(result.score).toBeCloseTo(base * 0.6, 2);
  });

  it("should have high confidence for 10+ visits", () => {
    const visits = Array.from({ length: 12 }, () => makeVisit(5));
    const result = scoreRelationship(visits, now);

    expect(result.confidence).toBe("high");
  });
});
