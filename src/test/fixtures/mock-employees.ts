/**
 * Mock employee data for testing and mock-alaya seed.
 * 150 caregiver profiles with edge cases:
 * - Null coordinates (employees 141-150)
 * - Various statuses (active, inactive, on_leave)
 * - Varied demographics
 */

export interface MockEmployee {
  id: number;
  username: string;
  status: string;
  latitude: number | null;
  longitude: number | null;
  demographics: { first_name: string; last_name: string };
}

const FIRST_NAMES = [
  "Alice", "Bob", "Carol", "David", "Emma", "Frank", "Grace", "Henry", "Iris", "Jack",
  "Kate", "Leo", "Mia", "Noah", "Olivia", "Paul", "Quinn", "Ruby", "Sam", "Tina",
  "Uma", "Victor", "Wendy", "Xavier", "Yara", "Zack", "Amara", "Ben", "Clara", "Dan",
];

const LAST_NAMES = [
  "Johnson", "Smith", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez", "Martinez",
  "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson", "Thomas", "Taylor", "Moore", "Jackson", "Martin",
  "Lee", "Perez", "Thompson", "White", "Harris", "Sanchez", "Clark", "Ramirez", "Lewis", "Robinson",
];

// Melbourne CBD area coordinates as baseline
const BASE_LAT = -37.8136;
const BASE_LNG = 144.9631;

function generateEmployees(): MockEmployee[] {
  const employees: MockEmployee[] = [];

  for (let i = 1; i <= 150; i++) {
    const firstName = FIRST_NAMES[(i - 1) % FIRST_NAMES.length];
    const lastName = LAST_NAMES[(i - 1) % LAST_NAMES.length];

    // Edge case: employees 141-150 have null coordinates
    const hasCoords = i <= 140;

    // Edge case: employees 146-148 are inactive, 149-150 are on_leave
    let status = "active";
    if (i >= 146 && i <= 148) status = "inactive";
    if (i >= 149) status = "on_leave";

    employees.push({
      id: i,
      username: `${firstName.toLowerCase()}.${lastName.toLowerCase()}${i}`,
      status,
      latitude: hasCoords ? BASE_LAT + (Math.random() - 0.5) * 0.4 : null,
      longitude: hasCoords ? BASE_LNG + (Math.random() - 0.5) * 0.4 : null,
      demographics: {
        first_name: firstName,
        last_name: lastName,
      },
    });
  }

  return employees;
}

export const MOCK_EMPLOYEES: MockEmployee[] = generateEmployees();

// Named subsets for targeted testing
export const EMPLOYEES_WITH_COORDS = MOCK_EMPLOYEES.filter((e) => e.latitude !== null);
export const EMPLOYEES_WITHOUT_COORDS = MOCK_EMPLOYEES.filter((e) => e.latitude === null);
export const ACTIVE_EMPLOYEES = MOCK_EMPLOYEES.filter((e) => e.status === "active");
export const INACTIVE_EMPLOYEES = MOCK_EMPLOYEES.filter((e) => e.status !== "active");
