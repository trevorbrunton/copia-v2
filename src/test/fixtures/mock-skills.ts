/**
 * Mock skill data for testing and mock-alaya seed.
 * Covers edge cases:
 * - Expired skills
 * - Skills expiring soon (within 30 days)
 * - Employees with no skills
 * - Employees with many skills
 */

export interface MockSkill {
  skill_id: number;
  expired_date: string | null;
}

export interface MockEmployeeSkills {
  employee_id: number;
  skills: MockSkill[];
}

// Reference skill IDs (matching mock-alaya skill catalog)
export const SKILL_IDS = {
  FIRST_AID: 1,
  MANUAL_HANDLING: 2,
  MEDICATION_ADMIN: 3,
  WOUND_CARE: 4,
  DEMENTIA_CARE: 5,
  PALLIATIVE_CARE: 6,
  PEG_FEEDING: 7,
  CATHETER_CARE: 8,
  DIABETES_MANAGEMENT: 9,
  MENTAL_HEALTH: 10,
};

const ALL_SKILL_IDS = Object.values(SKILL_IDS);

function generateEmployeeSkills(): MockEmployeeSkills[] {
  const result: MockEmployeeSkills[] = [];
  const now = new Date();
  const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const sixMonthsAgo = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
  const oneYearFromNow = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

  for (let empId = 1; empId <= 150; empId++) {
    // Edge case: employees 131-140 have NO skills
    if (empId >= 131 && empId <= 140) {
      result.push({ employee_id: empId, skills: [] });
      continue;
    }

    // Edge case: employees 121-125 have EXPIRED skills only
    if (empId >= 121 && empId <= 125) {
      result.push({
        employee_id: empId,
        skills: [
          { skill_id: SKILL_IDS.FIRST_AID, expired_date: sixMonthsAgo.toISOString().split("T")[0] },
          { skill_id: SKILL_IDS.MANUAL_HANDLING, expired_date: sixMonthsAgo.toISOString().split("T")[0] },
        ],
      });
      continue;
    }

    // Edge case: employees 126-130 have skills EXPIRING SOON
    if (empId >= 126 && empId <= 130) {
      result.push({
        employee_id: empId,
        skills: [
          { skill_id: SKILL_IDS.FIRST_AID, expired_date: thirtyDaysFromNow.toISOString().split("T")[0] },
          { skill_id: SKILL_IDS.MANUAL_HANDLING, expired_date: oneYearFromNow.toISOString().split("T")[0] },
          { skill_id: SKILL_IDS.MEDICATION_ADMIN, expired_date: null },
        ],
      });
      continue;
    }

    // Regular employees: varied skill counts (2-8 skills)
    const skillCount = 2 + (empId % 7);
    const employeeSkills: MockSkill[] = [];
    for (let s = 0; s < skillCount && s < ALL_SKILL_IDS.length; s++) {
      const skillId = ALL_SKILL_IDS[(empId + s) % ALL_SKILL_IDS.length];
      employeeSkills.push({
        skill_id: skillId,
        expired_date: oneYearFromNow.toISOString().split("T")[0],
      });
    }

    result.push({ employee_id: empId, skills: employeeSkills });
  }

  return result;
}

export const MOCK_EMPLOYEE_SKILLS: MockEmployeeSkills[] = generateEmployeeSkills();

// Named subsets
export const EMPLOYEES_WITH_NO_SKILLS = MOCK_EMPLOYEE_SKILLS.filter((e) => e.skills.length === 0);
export const EMPLOYEES_WITH_EXPIRED_SKILLS = MOCK_EMPLOYEE_SKILLS.filter(
  (e) => e.skills.length > 0 && e.skills.every((s) => s.expired_date && new Date(s.expired_date) < new Date())
);
