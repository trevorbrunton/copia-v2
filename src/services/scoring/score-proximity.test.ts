import { describe, it, expect } from "vitest";
import { scoreProximity } from "./score-proximity";

describe("scoreProximity", () => {
  it("should return 1.0 for same location", () => {
    const result = scoreProximity(-33.8688, 151.2093, -33.8688, 151.2093);

    expect(result.score).toBeCloseTo(1.0, 2);
    expect(result.confidence).toBe("high");
  });

  it("should return ~0.5 for 25km distance", () => {
    // Sydney CBD to Parramatta ≈ 24km
    const result = scoreProximity(-33.8688, 151.2093, -33.8148, 151.0017);

    expect(result.score).toBeGreaterThan(0.4);
    expect(result.score).toBeLessThan(0.6);
    expect(result.confidence).toBe("high");
  });

  it("should return 0.0 for 50km+ distance", () => {
    // Sydney to Wollongong ≈ 68km
    const result = scoreProximity(-33.8688, 151.2093, -34.4278, 150.8931);

    expect(result.score).toBeCloseTo(0.0);
    expect(result.confidence).toBe("high");
  });

  it("should return 0.0 low confidence when employee coords are null", () => {
    const result = scoreProximity(null, null, -33.8688, 151.2093);

    expect(result.score).toBeCloseTo(0.0);
    expect(result.confidence).toBe("low");
    expect(result.reason).toContain("coordinates");
  });

  it("should return 0.0 low confidence when client coords are null", () => {
    const result = scoreProximity(-33.8688, 151.2093, null, null);

    expect(result.score).toBeCloseTo(0.0);
    expect(result.confidence).toBe("low");
  });
});
