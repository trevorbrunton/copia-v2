import { describe, it, expect } from "vitest";
import { checkHardConstraints, checkScheduleConflicts, checkSkillQualifications } from "./constraints";

// Minimal types matching AlayaCare data shapes
const baseEmployee = { id: 1, name: "Alice" };

const makeSkill = (skill_id: number, expired_date: string | null) => ({
  skill_id,
  expired_date,
});

const makeVisit = (start_at: string, end_at: string) => ({
  start_at,
  end_at,
});

const targetVisit = {
  required_skill_ids: [10, 20],
  start_at: "2026-03-11T09:00:00Z",
  end_at: "2026-03-11T11:00:00Z",
};

const now = new Date("2026-03-11T08:00:00Z");

describe("checkHardConstraints", () => {
  it("should pass when employee has all required skills and no conflicts", () => {
    const skills = [
      makeSkill(10, "2027-01-01"),
      makeSkill(20, null), // null = no expiry
    ];
    const schedule: ReturnType<typeof makeVisit>[] = [];

    const result = checkHardConstraints(
      baseEmployee,
      skills,
      schedule,
      targetVisit,
      now
    );

    expect(result.eligible).toBe(true);
    expect(result.failed_constraints).toHaveLength(0);
  });

  it("should fail when employee is missing a required qualification", () => {
    const skills = [makeSkill(10, "2027-01-01")]; // missing skill 20
    const schedule: ReturnType<typeof makeVisit>[] = [];

    const result = checkHardConstraints(
      baseEmployee,
      skills,
      schedule,
      targetVisit,
      now
    );

    expect(result.eligible).toBe(false);
    expect(result.failed_constraints).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Missing required qualification"),
      ])
    );
  });

  it("should fail when a required qualification is expired", () => {
    const skills = [
      makeSkill(10, "2025-01-01"), // expired
      makeSkill(20, null),
    ];
    const schedule: ReturnType<typeof makeVisit>[] = [];

    const result = checkHardConstraints(
      baseEmployee,
      skills,
      schedule,
      targetVisit,
      now
    );

    expect(result.eligible).toBe(false);
    expect(result.failed_constraints).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Expired qualification"),
      ])
    );
  });

  it("should fail when employee has a schedule conflict", () => {
    const skills = [makeSkill(10, "2027-01-01"), makeSkill(20, null)];
    // Overlapping visit: 10:00–12:00 overlaps target 09:00–11:00
    const schedule = [makeVisit("2026-03-11T10:00:00Z", "2026-03-11T12:00:00Z")];

    const result = checkHardConstraints(
      baseEmployee,
      skills,
      schedule,
      targetVisit,
      now
    );

    expect(result.eligible).toBe(false);
    expect(result.failed_constraints).toEqual(
      expect.arrayContaining([expect.stringContaining("Schedule conflict")])
    );
  });

  it("should pass when no required qualifications (all eligible)", () => {
    const visitNoReqs = {
      required_skill_ids: [] as number[],
      start_at: "2026-03-11T09:00:00Z",
      end_at: "2026-03-11T11:00:00Z",
    };
    const skills: ReturnType<typeof makeSkill>[] = [];
    const schedule: ReturnType<typeof makeVisit>[] = [];

    const result = checkHardConstraints(
      baseEmployee,
      skills,
      schedule,
      visitNoReqs,
      now
    );

    expect(result.eligible).toBe(true);
    expect(result.failed_constraints).toHaveLength(0);
  });

  it("should pass when employee has empty schedule (no conflicts)", () => {
    const skills = [makeSkill(10, "2027-01-01"), makeSkill(20, null)];
    const schedule: ReturnType<typeof makeVisit>[] = [];

    const result = checkHardConstraints(
      baseEmployee,
      skills,
      schedule,
      targetVisit,
      now
    );

    expect(result.eligible).toBe(true);
    expect(result.failed_constraints).toHaveLength(0);
  });

  it("should pass when schedule visits do not overlap", () => {
    const skills = [makeSkill(10, "2027-01-01"), makeSkill(20, null)];
    // Visit before: 06:00–08:00, visit after: 12:00–14:00
    const schedule = [
      makeVisit("2026-03-11T06:00:00Z", "2026-03-11T08:00:00Z"),
      makeVisit("2026-03-11T12:00:00Z", "2026-03-11T14:00:00Z"),
    ];

    const result = checkHardConstraints(
      baseEmployee,
      skills,
      schedule,
      targetVisit,
      now
    );

    expect(result.eligible).toBe(true);
    expect(result.failed_constraints).toHaveLength(0);
  });

  it("should collect multiple failures", () => {
    const skills = [makeSkill(10, "2025-01-01")]; // expired + missing skill 20
    const schedule = [makeVisit("2026-03-11T10:00:00Z", "2026-03-11T12:00:00Z")]; // conflict

    const result = checkHardConstraints(
      baseEmployee,
      skills,
      schedule,
      targetVisit,
      now
    );

    expect(result.eligible).toBe(false);
    expect(result.failed_constraints.length).toBeGreaterThanOrEqual(2);
  });

  it("should treat exactly-touching boundaries as non-overlapping", () => {
    const skills = [makeSkill(10, "2027-01-01"), makeSkill(20, null)];
    // Ends exactly when target starts
    const schedule = [makeVisit("2026-03-11T07:00:00Z", "2026-03-11T09:00:00Z")];

    const result = checkHardConstraints(
      baseEmployee,
      skills,
      schedule,
      targetVisit,
      now
    );

    expect(result.eligible).toBe(true);
    expect(result.failed_constraints).toHaveLength(0);
  });
});

describe("checkScheduleConflicts", () => {
  it("should pass with no schedule", () => {
    const result = checkScheduleConflicts([], targetVisit);
    expect(result.eligible).toBe(true);
  });

  it("should detect overlap", () => {
    const schedule = [makeVisit("2026-03-11T10:00:00Z", "2026-03-11T12:00:00Z")];
    const result = checkScheduleConflicts(schedule, targetVisit);
    expect(result.eligible).toBe(false);
    expect(result.failed_constraints[0]).toContain("Schedule conflict");
  });

  it("should pass for non-overlapping schedule", () => {
    const schedule = [makeVisit("2026-03-11T12:00:00Z", "2026-03-11T14:00:00Z")];
    const result = checkScheduleConflicts(schedule, targetVisit);
    expect(result.eligible).toBe(true);
  });
});

describe("checkSkillQualifications", () => {
  it("should pass when all required skills present and valid", () => {
    const skills = [makeSkill(10, "2027-01-01"), makeSkill(20, null)];
    const result = checkSkillQualifications(skills, [10, 20], now);
    expect(result.eligible).toBe(true);
  });

  it("should fail for missing skill", () => {
    const skills = [makeSkill(10, "2027-01-01")];
    const result = checkSkillQualifications(skills, [10, 20], now);
    expect(result.eligible).toBe(false);
    expect(result.failed_constraints[0]).toContain("Missing required qualification");
  });

  it("should fail for expired skill", () => {
    const skills = [makeSkill(10, "2025-01-01"), makeSkill(20, null)];
    const result = checkSkillQualifications(skills, [10, 20], now);
    expect(result.eligible).toBe(false);
    expect(result.failed_constraints[0]).toContain("Expired qualification");
  });

  it("should pass with no required skills", () => {
    const result = checkSkillQualifications([], [], now);
    expect(result.eligible).toBe(true);
  });
});
