/**
 * Mock data fixtures barrel export.
 * 150 employees, 55 visits, 10 skills, ~800 offers.
 *
 * Edge cases covered:
 * - Employees: null coords (141-150), inactive (146-148), on_leave (149-150)
 * - Skills: no skills (131-140), expired only (121-125), expiring soon (126-130)
 * - Visits: null client (41-45), vacant (46-50), overlapping (51-55), no required skills (36-40)
 * - Offers: high acceptance (101-105), high decline (106-110), no history (111-120)
 */

export { MOCK_EMPLOYEES, EMPLOYEES_WITH_COORDS, EMPLOYEES_WITHOUT_COORDS, ACTIVE_EMPLOYEES, INACTIVE_EMPLOYEES } from "./mock-employees";
export type { MockEmployee } from "./mock-employees";

export { MOCK_EMPLOYEE_SKILLS, EMPLOYEES_WITH_NO_SKILLS, EMPLOYEES_WITH_EXPIRED_SKILLS, SKILL_IDS } from "./mock-skills";
export type { MockSkill, MockEmployeeSkills } from "./mock-skills";

export { MOCK_VISITS, COMPLETED_VISITS, VACANT_VISITS, CLOCKED_VISITS, VISITS_WITHOUT_CLIENT, OVERLAPPING_VISITS, VISITS_WITHOUT_REQUIRED_SKILLS } from "./mock-visits";
export type { MockVisit } from "./mock-visits";

export { MOCK_OFFERS, HIGH_ACCEPTANCE_EMPLOYEES, HIGH_DECLINE_EMPLOYEES, NO_HISTORY_EMPLOYEES } from "./mock-offers";
export type { MockOffer } from "./mock-offers";
