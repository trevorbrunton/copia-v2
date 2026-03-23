import { describe, it, expect } from "vitest";
import { scoreSkills } from "./score-skills";

const makeSkill = (skill_id: number, expired_date: string | null) => ({
  skill_id,
  expired_date,
});

const now = new Date("2026-03-11T08:00:00Z");

describe("scoreSkills", () => {
  it("should return 1.0 high confidence when all required skills matched", () => {
    const empSkills = [makeSkill(10, "2027-01-01"), makeSkill(20, null)];
    const required = [10, 20];

    const result = scoreSkills(empSkills, required, now);

    expect(result.score).toBeCloseTo(1.0);
    expect(result.confidence).toBe("high");
  });

  it("should return partial score for partial match", () => {
    const empSkills = [makeSkill(10, "2027-01-01")];
    const required = [10, 20];

    const result = scoreSkills(empSkills, required, now);

    expect(result.score).toBeCloseTo(0.5);
    expect(result.confidence).toBe("high");
  });

  it("should return 0.0 when no required skills matched", () => {
    const empSkills = [makeSkill(99, "2027-01-01")];
    const required = [10, 20];

    const result = scoreSkills(empSkills, required, now);

    expect(result.score).toBeCloseTo(0.0);
    expect(result.confidence).toBe("high");
  });

  it("should not count expired skills as matched", () => {
    const empSkills = [
      makeSkill(10, "2025-01-01"), // expired
      makeSkill(20, null),
    ];
    const required = [10, 20];

    const result = scoreSkills(empSkills, required, now);

    expect(result.score).toBeCloseTo(0.5);
  });

  it("should return 1.0 low confidence when no requirements", () => {
    const empSkills = [makeSkill(10, "2027-01-01")];
    const required: number[] = [];

    const result = scoreSkills(empSkills, required, now);

    expect(result.score).toBeCloseTo(1.0);
    expect(result.confidence).toBe("low");
    expect(result.reason).toContain("no required skills");
  });

  it("should include reason with counts", () => {
    const empSkills = [makeSkill(10, "2027-01-01"), makeSkill(20, null)];
    const required = [10, 20, 30];

    const result = scoreSkills(empSkills, required, now);

    expect(result.reason).toContain("2");
    expect(result.reason).toContain("3");
  });
});
