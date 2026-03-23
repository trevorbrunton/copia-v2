import type { DimensionScore, EmployeeSkillRef } from "./types";

/**
 * Scores soft skills fit: valid_matched / required_count.
 * Hard filter already removed unqualified candidates — this scores degree of fit.
 */
export function scoreSkills(
  employeeSkills: EmployeeSkillRef[],
  requiredSkillIds: number[],
  now: Date
): DimensionScore {
  if (requiredSkillIds.length === 0) {
    return {
      score: 1.0,
      confidence: "low",
      reason: "Visit has no required skills defined",
    };
  }

  const validSkillIds = new Set(
    employeeSkills
      .filter((s) => !s.expired_date || new Date(s.expired_date) >= now)
      .map((s) => s.skill_id)
  );

  const matched = requiredSkillIds.filter((id) => validSkillIds.has(id)).length;
  const score = matched / requiredSkillIds.length;

  return {
    score,
    confidence: "high",
    reason: `${matched} of ${requiredSkillIds.length} required skills matched`,
  };
}
