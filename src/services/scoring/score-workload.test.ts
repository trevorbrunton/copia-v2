import { describe, it, expect } from "vitest";
import { scoreWorkload } from "./score-workload";

describe("scoreWorkload", () => {
  it("should return 1.0 when at pool mean", () => {
    const result = scoreWorkload(5, 5, 2);

    expect(result.score).toBeCloseTo(1.0);
    expect(result.confidence).toBe("high");
  });

  it("should penalise 1σ above mean more than 1σ below (asymmetric)", () => {
    const above = scoreWorkload(7, 5, 2); // z = 1.0, overload penalty ×1.5
    const below = scoreWorkload(3, 5, 2); // z = -1.0, no penalty

    // Both use exp(-0.5 × z²) but above has 1.5× z
    expect(above.score).toBeLessThan(below.score);
    expect(below.score).toBeCloseTo(Math.exp(-0.5), 2); // exp(-0.5) ≈ 0.607
  });

  it("should return 1.0 when stddev is 0 (all same workload)", () => {
    const result = scoreWorkload(5, 5, 0);

    expect(result.score).toBeCloseTo(1.0);
    expect(result.confidence).toBe("medium");
  });

  it("should return 1.0 for employee with 0 shifts when pool mean is 0", () => {
    const result = scoreWorkload(0, 0, 0);

    expect(result.score).toBeCloseTo(1.0);
  });

  it("should score heavily loaded employee low", () => {
    // 10 shifts, mean 5, stddev 2 → z = 2.5, with 1.5× penalty → effective z = 3.75
    const result = scoreWorkload(10, 5, 2);

    expect(result.score).toBeLessThan(0.1);
  });
});
