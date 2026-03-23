import type {
  HardConstraintResult,
  EmployeeSkillRef,
  ScheduleVisitRef,
} from "./types";

interface TargetVisitRef {
  required_skill_ids: number[];
  start_at: string;
  end_at: string;
}

/**
 * Phase 1 pre-filter: checks schedule conflicts only (no skills data needed).
 * Use this to narrow the candidate pool before fetching per-employee skills.
 */
export function checkScheduleConflicts(
  employeeSchedule: ScheduleVisitRef[],
  visit: { start_at: string; end_at: string }
): HardConstraintResult {
  const failed: string[] = [];
  const targetStart = new Date(visit.start_at).getTime();
  const targetEnd = new Date(visit.end_at).getTime();

  for (const existing of employeeSchedule) {
    const existingStart = new Date(existing.start_at).getTime();
    const existingEnd = new Date(existing.end_at).getTime();

    if (targetStart < existingEnd && existingStart < targetEnd) {
      failed.push(
        `Schedule conflict: existing visit ${existing.start_at}–${existing.end_at}`
      );
    }
  }

  return {
    eligible: failed.length === 0,
    failed_constraints: failed,
  };
}

/**
 * Phase 2 filter: checks skill qualifications (requires skills data).
 */
export function checkSkillQualifications(
  employeeSkills: EmployeeSkillRef[],
  requiredSkillIds: number[],
  now: Date
): HardConstraintResult {
  const failed: string[] = [];

  for (const reqId of requiredSkillIds) {
    const skill = employeeSkills.find((s) => s.skill_id === reqId);
    if (!skill) {
      failed.push(`Missing required qualification: skill ${reqId}`);
      continue;
    }
    if (skill.expired_date && new Date(skill.expired_date) < now) {
      failed.push(`Expired qualification: skill ${reqId}`);
    }
  }

  return {
    eligible: failed.length === 0,
    failed_constraints: failed,
  };
}

/**
 * Combined hard constraint filter: checks both qualifications and schedule conflicts.
 * Retained for backwards compatibility and tests.
 */
export function checkHardConstraints(
  _employee: { id: number },
  employeeSkills: EmployeeSkillRef[],
  employeeSchedule: ScheduleVisitRef[],
  visit: TargetVisitRef,
  now: Date
): HardConstraintResult {
  const schedule = checkScheduleConflicts(employeeSchedule, visit);
  const skills = checkSkillQualifications(employeeSkills, visit.required_skill_ids, now);

  const failed = [...schedule.failed_constraints, ...skills.failed_constraints];
  return {
    eligible: failed.length === 0,
    failed_constraints: failed,
  };
}
