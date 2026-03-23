/**
 * Mock visit/shift data for testing and mock-alaya seed.
 * 50 shifts covering edge cases:
 * - Various statuses (scheduled, vacant, completed, cancelled, clocked, offered, late, missed)
 * - Overlapping shifts for conflict testing
 * - Shifts with and without assigned employees
 * - Shifts with and without clock_in/clock_out
 * - Shifts with null client_id
 */

export interface MockVisit {
  id: number;
  external_id: string | null;
  client_id: number | null;
  employee_id: number | null;
  service_id: number | null;
  start_at: string;
  end_at: string;
  status: string;
  service_instructions: string | null;
  clock_in: string | null;
  clock_out: string | null;
  required_skill_ids: number[];
  created_at: string;
  updated_at: string;
}

// Client IDs used across visits (20 distinct clients)
const CLIENT_IDS = Array.from({ length: 20 }, (_, i) => i + 1);

const SERVICE_INSTRUCTIONS = [
  "Assist with morning routine, medication administration",
  "Personal care, shower assistance, light meal preparation",
  "Wound dressing change and vitals monitoring",
  "Companionship visit, mobility exercises, light housekeeping",
  "Medication management, blood pressure check",
  null,
];

function generateVisits(): MockVisit[] {
  const visits: MockVisit[] = [];
  const baseDate = new Date("2026-03-15");

  for (let i = 1; i <= 50; i++) {
    // Spread across 5 days
    const dayOffset = Math.floor((i - 1) / 10);
    const date = new Date(baseDate);
    date.setDate(date.getDate() + dayOffset);

    // Morning or afternoon slot
    const isMorning = i % 2 === 0;
    const startHour = isMorning ? 8 + (i % 3) : 13 + (i % 3);
    const durationHours = 1 + (i % 3); // 1-3 hours

    const start = new Date(date);
    start.setHours(startHour, 0, 0, 0);
    const end = new Date(start);
    end.setHours(start.getHours() + durationHours);

    // Edge case: visits 41-45 have null client_id
    const clientId = i >= 41 && i <= 45 ? null : CLIENT_IDS[(i - 1) % CLIENT_IDS.length];

    // Edge case: visits 46-50 are vacant (no employee)
    // Normal visits: assign employees from pool
    const employeeId = i >= 46 ? null : ((i - 1) % 140) + 1;

    // Determine status and clock data
    let status: string;
    let clockIn: string | null = null;
    let clockOut: string | null = null;

    if (i <= 10) {
      // Completed shifts with clock data
      status = "completed";
      clockIn = new Date(start.getTime() + 2 * 60000).toISOString(); // 2 min after start
      clockOut = new Date(end.getTime() + 5 * 60000).toISOString(); // 5 min after end
    } else if (i <= 15) {
      // In-progress (clocked in, no clock out)
      status = "clocked";
      clockIn = new Date(start.getTime() - 1 * 60000).toISOString(); // 1 min early
    } else if (i <= 20) {
      // Offered but not confirmed
      status = "offered";
    } else if (i <= 25) {
      // Scheduled (normal upcoming)
      status = "scheduled";
    } else if (i <= 30) {
      // Cancelled
      status = "cancelled";
    } else if (i <= 35) {
      // Late (past start, no clock in)
      status = "late";
    } else if (i <= 40) {
      // Missed (past end, no clock in)
      status = "missed";
    } else if (i <= 45) {
      // Null client visits — scheduled
      status = "scheduled";
    } else {
      // Vacant
      status = "vacant";
    }

    // Required skills: vary per visit (edge case: visits 36-40 have no required skills)
    const requiredSkills =
      i >= 36 && i <= 40
        ? []
        : [1, 2].concat(i % 3 === 0 ? [3] : []).concat(i % 5 === 0 ? [5] : []);

    visits.push({
      id: i,
      external_id: `EXT-${String(i).padStart(4, "0")}`,
      client_id: clientId,
      employee_id: employeeId,
      service_id: (i % 5) + 1,
      start_at: start.toISOString(),
      end_at: end.toISOString(),
      status,
      service_instructions: SERVICE_INSTRUCTIONS[(i - 1) % SERVICE_INSTRUCTIONS.length],
      clock_in: clockIn,
      clock_out: clockOut,
      required_skill_ids: requiredSkills,
      created_at: new Date(baseDate.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      updated_at: new Date(baseDate.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString(),
    });
  }

  // Add overlapping shifts for conflict testing (employees 1-5 have double-booked slots)
  for (let i = 51; i <= 55; i++) {
    const conflictEmpId = i - 50;
    // Same time as visit (conflictEmpId), creating a scheduling conflict
    const originalVisit = visits[conflictEmpId - 1];
    visits.push({
      id: i,
      external_id: `EXT-${String(i).padStart(4, "0")}`,
      client_id: CLIENT_IDS[10 + (i % 5)],
      employee_id: conflictEmpId,
      service_id: 1,
      start_at: originalVisit.start_at,
      end_at: originalVisit.end_at,
      status: "scheduled",
      service_instructions: "Conflict test — overlapping shift",
      clock_in: null,
      clock_out: null,
      required_skill_ids: [1],
      created_at: originalVisit.created_at,
      updated_at: originalVisit.updated_at,
    });
  }

  return visits;
}

export const MOCK_VISITS: MockVisit[] = generateVisits();

// Named subsets
export const COMPLETED_VISITS = MOCK_VISITS.filter((v) => v.status === "completed");
export const VACANT_VISITS = MOCK_VISITS.filter((v) => v.status === "vacant");
export const CLOCKED_VISITS = MOCK_VISITS.filter((v) => v.status === "clocked");
export const VISITS_WITHOUT_CLIENT = MOCK_VISITS.filter((v) => v.client_id === null);
export const OVERLAPPING_VISITS = MOCK_VISITS.filter((v) => v.id >= 51);
export const VISITS_WITHOUT_REQUIRED_SKILLS = MOCK_VISITS.filter(
  (v) => v.required_skill_ids.length === 0
);
