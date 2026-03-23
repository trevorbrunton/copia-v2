/**
 * Shared helpers, types, and scenario definitions for scoring tests.
 *
 * Extracted from scenarios.test.ts and comparison-report.test.ts to
 * eliminate duplication. Both test files import from here.
 *
 * NOTE: This file must NOT import vitest or call vi.mock — that would
 * cause cross-file mock contamination. The mock function is passed in
 * via `setupScenario`'s second parameter.
 */
import type { AlayaRequestOptions } from "@/src/lib/alayacare-client";

// ── Types ──

export interface ScenarioEmployee {
  id: number;
  name: string;
  lat: number | null;
  lng: number | null;
}

export interface ScenarioData {
  visitId?: number;
  clientId?: number | null;
  visitStart?: string;
  visitEnd?: string;
  requiredSkillIds?: number[];
  clientLat?: number | null;
  clientLng?: number | null;
  employees: ScenarioEmployee[];
  skillsByEmployee?: Record<number, { skill_id: number; expired_date: string | null }[]>;
  schedulesByEmployee?: Record<number, { start_at: string; end_at: string; employee_id: number }[]>;
  clientVisitHistory?: { employee_id: number; start_at: string }[];
  offersByEmployee?: Record<number, { employee_id: number; status: string }[]>;
}

// ── Scenario Defaults ──

/** Default visit ID used by all scenarios */
export const DEFAULT_VISIT_ID = 100;
/** Default visit start time */
export const DEFAULT_VISIT_START = "2026-03-15T09:00:00Z";
/** Default visit end time */
export const DEFAULT_VISIT_END = "2026-03-15T11:00:00Z";

// ── Location Constants ──

/** Melbourne CBD baseline */
export const CBD = { lat: -37.8136, lng: 144.9631 };
/** ~10km away (Footscray) */
export const NEAR = { lat: -37.7996, lng: 144.8992 };
/** ~25km away (Ringwood) */
export const MID = { lat: -37.8155, lng: 145.2283 };
/** ~60km away (Geelong) */
export const FAR = { lat: -38.1499, lng: 144.3617 };
/** Rural client ~60km from Melbourne */
export const RURAL_CLIENT = { lat: -38.35, lng: 145.20 };

// ── Builder Functions ──

export function makeAccepted(empId: number, count: number) {
  return Array.from({ length: count }, () => ({ employee_id: empId, status: "accepted" }));
}

export function makeDeclined(empId: number, count: number) {
  return Array.from({ length: count }, () => ({ employee_id: empId, status: "declined" }));
}

export function makeMixed(empId: number, accepted: number, declined: number) {
  return [...makeAccepted(empId, accepted), ...makeDeclined(empId, declined)];
}

export function makeRecentVisits(empId: number, count: number, daysAgo: number = 3) {
  const base = new Date("2026-03-15T09:00:00Z");
  return Array.from({ length: count }, (_, i) => ({
    employee_id: empId,
    start_at: new Date(base.getTime() - (daysAgo + i) * 24 * 60 * 60 * 1000).toISOString(),
  }));
}

// ── Mock Wiring ──

export function getSearchParam(
  options: AlayaRequestOptions | undefined,
  key: string
): string | null {
  if (!options?.searchParams) return null;
  if (options.searchParams instanceof URLSearchParams) {
    return options.searchParams.get(key);
  }
  return (options.searchParams as Record<string, string>)[key] ?? null;
}

type MockAlayaFetch = {
  mockImplementation: (fn: (path: string, options?: AlayaRequestOptions) => Promise<unknown>) => void;
};

/**
 * Configures the mocked alayaFetch for a scenario.
 * The mock reference is passed in so this file stays vitest-free.
 */
export function setupScenario(data: ScenarioData, mockedAlayaFetch: MockAlayaFetch) {
  const visitId = data.visitId ?? DEFAULT_VISIT_ID;
  const visit = {
    id: visitId,
    client_id: "clientId" in data ? data.clientId : 10,
    start_at: data.visitStart ?? DEFAULT_VISIT_START,
    end_at: data.visitEnd ?? DEFAULT_VISIT_END,
    status: "scheduled",
    required_skill_ids: data.requiredSkillIds ?? [],
  };

  const client = {
    id: ("clientId" in data ? data.clientId : 10) ?? 0,
    latitude: "clientLat" in data ? data.clientLat : -37.8136,
    longitude: "clientLng" in data ? data.clientLng : 144.9631,
  };

  const employees = data.employees.map((e) => ({
    id: e.id,
    username: e.name.toLowerCase().replace(" ", "."),
    status: "active",
    latitude: e.lat,
    longitude: e.lng,
    demographics: {
      first_name: e.name.split(" ")[0],
      last_name: e.name.split(" ")[1] ?? "Test",
    },
  }));

  const defaultSkills: Record<number, { skill_id: number; expired_date: string | null }[]> = Object.fromEntries(
    data.employees.map((e) => [e.id, [] as { skill_id: number; expired_date: string | null }[]])
  );
  const skillsByEmployee: Record<number, { skill_id: number; expired_date: string | null }[]> = { ...defaultSkills, ...data.skillsByEmployee };

  const allSchedules = Object.entries(data.schedulesByEmployee ?? {}).flatMap(
    ([, visits]) => visits
  );
  const allOffers = Object.entries(data.offersByEmployee ?? {}).flatMap(
    ([, offers]) => offers
  );

  mockedAlayaFetch.mockImplementation(
    async (path: string, options?: AlayaRequestOptions) => {
      if (path === `/scheduler/visits/${visitId}`) return visit;
      if (path.startsWith("/patients/clients/")) return client;
      if (path.match(/\/employees\/employees\/\d+\/skills/)) {
        const empId = Number(path.match(/\/employees\/employees\/(\d+)\/skills/)?.[1]);
        return { items: skillsByEmployee[empId] ?? [], count: (skillsByEmployee[empId] ?? []).length };
      }
      if (path === "/employees") return { items: employees, count: employees.length };
      if (path === "/scheduler/visits") {
        if (getSearchParam(options, "date")) return { items: allSchedules, count: allSchedules.length };
        if (getSearchParam(options, "client_id")) return { items: data.clientVisitHistory ?? [], count: (data.clientVisitHistory ?? []).length };
        return { items: [], count: 0 };
      }
      if (path === "/scheduler/visit_offers") return { items: allOffers, count: allOffers.length };
      throw new Error(`Unexpected path: ${path}`);
    }
  );
}

// ── Scenario Definitions (used by comparison-report.test.ts) ──

export interface ScenarioRun {
  id: string;
  setup: (mock: MockAlayaFetch) => void;
  preset?: string;
  weights?: Record<string, number>;
  limit?: number;
}

export const presetScenarioSetup = (mock: MockAlayaFetch) => {
  setupScenario({
    requiredSkillIds: [1],
    employees: [
      { id: 1, name: "High Accept Far", ...MID },
      { id: 2, name: "Low Accept Near", ...CBD },
      { id: 3, name: "Balanced Mid", ...NEAR },
    ],
    skillsByEmployee: {
      1: [{ skill_id: 1, expired_date: null }],
      2: [{ skill_id: 1, expired_date: null }],
      3: [{ skill_id: 1, expired_date: null }],
    },
    clientVisitHistory: [
      ...makeRecentVisits(1, 3, 5),
      ...makeRecentVisits(2, 12, 2),
      ...makeRecentVisits(3, 6, 10),
    ],
    offersByEmployee: {
      1: makeMixed(1, 18, 2),
      2: makeMixed(2, 2, 8),
      3: makeMixed(3, 3, 7),
    },
  }, mock);
};

/** Tomorrow's date string for expiring-soon scenarios */
const TOMORROW = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split("T")[0];

export const SCENARIOS: ScenarioRun[] = [
  // Category 1: Straightforward
  {
    id: "S1", preset: "planned",
    setup: (mock) => setupScenario({
      requiredSkillIds: [1, 2],
      employees: [
        { id: 1, name: "Alice Smith", ...CBD },
        { id: 2, name: "Bob Jones", ...MID },
        { id: 3, name: "Carol Lee", ...MID },
        { id: 4, name: "Dave Park", ...NEAR },
      ],
      skillsByEmployee: {
        1: [{ skill_id: 1, expired_date: null }, { skill_id: 2, expired_date: null }],
        2: [{ skill_id: 1, expired_date: null }, { skill_id: 2, expired_date: null }],
        3: [{ skill_id: 1, expired_date: null }, { skill_id: 2, expired_date: null }],
        4: [{ skill_id: 1, expired_date: null }, { skill_id: 2, expired_date: null }],
      },
      clientVisitHistory: [
        ...makeRecentVisits(1, 15, 2), ...makeRecentVisits(2, 3, 20),
        ...makeRecentVisits(3, 2, 40), ...makeRecentVisits(4, 1, 5),
      ],
      offersByEmployee: {
        1: makeMixed(1, 18, 2), 2: makeMixed(2, 5, 5),
        3: makeMixed(3, 3, 7), 4: makeMixed(4, 8, 2),
      },
    }, mock),
  },
  {
    id: "S2", preset: "planned",
    setup: (mock) => setupScenario({
      requiredSkillIds: [1],
      employees: [
        { id: 1, name: "Alice Smith", ...CBD },
        { id: 2, name: "Bob Jones", ...CBD },
        { id: 3, name: "Carol Lee", ...NEAR },
      ],
      skillsByEmployee: { 1: [{ skill_id: 1, expired_date: null }], 2: [{ skill_id: 1, expired_date: null }], 3: [{ skill_id: 1, expired_date: null }] },
      clientVisitHistory: [...makeRecentVisits(1, 10, 2), ...makeRecentVisits(2, 10, 2), ...makeRecentVisits(3, 2, 30)],
      offersByEmployee: { 1: makeMixed(1, 12, 3), 2: makeMixed(2, 11, 4), 3: makeMixed(3, 5, 5) },
    }, mock),
  },
  {
    id: "S3", preset: "planned",
    setup: (mock) => setupScenario({
      employees: [{ id: 1, name: "Alice Smith", ...CBD }, { id: 2, name: "Bob Jones", ...CBD }, { id: 3, name: "Carol Lee", ...CBD }],
      clientVisitHistory: [...makeRecentVisits(1, 5, 2), ...makeRecentVisits(2, 5, 2), ...makeRecentVisits(3, 5, 2)],
      offersByEmployee: { 1: makeAccepted(1, 10), 2: makeAccepted(2, 10), 3: makeAccepted(3, 10) },
      schedulesByEmployee: {
        1: [{ start_at: "2026-03-15T06:00:00Z", end_at: "2026-03-15T08:00:00Z", employee_id: 1 }],
        2: [
          { start_at: "2026-03-15T06:00:00Z", end_at: "2026-03-15T08:00:00Z", employee_id: 2 },
          { start_at: "2026-03-15T12:00:00Z", end_at: "2026-03-15T14:00:00Z", employee_id: 2 },
          { start_at: "2026-03-15T15:00:00Z", end_at: "2026-03-15T17:00:00Z", employee_id: 2 },
        ],
        3: [],
      },
    }, mock),
  },
  {
    id: "S4",
    setup: (mock) => setupScenario({
      employees: [{ id: 1, name: "Alice Smith", ...CBD }],
      skillsByEmployee: { 1: [{ skill_id: 1, expired_date: null }] },
      offersByEmployee: { 1: makeAccepted(1, 10) },
    }, mock),
  },
  {
    id: "S5", limit: 10,
    setup: (mock) => {
      const emps = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, name: `Employee ${i + 1}`, ...CBD }));
      setupScenario({
        employees: emps,
        skillsByEmployee: Object.fromEntries(emps.map((e) => [e.id, [{ skill_id: 1, expired_date: null }]])),
        offersByEmployee: Object.fromEntries(emps.map((e) => [e.id, makeAccepted(e.id, 10)])),
      }, mock);
    },
  },
  // Category 2: Multi-Qualified
  {
    id: "M1",
    setup: (mock) => setupScenario({
      requiredSkillIds: [1, 2, 3],
      employees: [{ id: 1, name: "Specialist One", ...CBD }, { id: 2, name: "Generalist Two", ...CBD }, { id: 3, name: "Partial Three", ...CBD }],
      skillsByEmployee: {
        1: [1, 2, 3, 4].map((id) => ({ skill_id: id, expired_date: null })),
        2: [1, 2, 3].map((id) => ({ skill_id: id, expired_date: null })),
        3: [1, 2, 3].map((id) => ({ skill_id: id, expired_date: null })),
      },
      clientVisitHistory: [...makeRecentVisits(1, 5, 2), ...makeRecentVisits(2, 5, 2), ...makeRecentVisits(3, 5, 2)],
      offersByEmployee: { 1: makeAccepted(1, 10), 2: makeAccepted(2, 10), 3: makeAccepted(3, 10) },
    }, mock),
  },
  {
    id: "M2",
    setup: (mock) => setupScenario({
      requiredSkillIds: [1, 2, 3, 4],
      employees: [{ id: 1, name: "Full Match", ...CBD }, { id: 2, name: "Three Of Four", ...CBD }, { id: 3, name: "Two Of Four", ...CBD }],
      skillsByEmployee: {
        1: [1, 2, 3, 4].map((id) => ({ skill_id: id, expired_date: null })),
        2: [1, 2, 3].map((id) => ({ skill_id: id, expired_date: null })),
        3: [1, 2].map((id) => ({ skill_id: id, expired_date: null })),
      },
      offersByEmployee: { 1: makeAccepted(1, 10), 2: makeAccepted(2, 10), 3: makeAccepted(3, 10) },
    }, mock),
  },
  {
    id: "M3",
    setup: (mock) => setupScenario({
      requiredSkillIds: [],
      employees: [{ id: 1, name: "Alice Smith", ...CBD }, { id: 2, name: "Bob Jones", ...CBD }, { id: 3, name: "Carol Lee", ...CBD }],
      offersByEmployee: { 1: makeAccepted(1, 10), 2: makeAccepted(2, 10), 3: makeAccepted(3, 10) },
    }, mock),
  },
  {
    id: "M4",
    setup: (mock) => setupScenario({
      requiredSkillIds: [1],
      employees: [{ id: 1, name: "Expiring Soon", ...CBD }, { id: 2, name: "Valid Long", ...CBD }, { id: 3, name: "Padding Three", ...CBD }],
      skillsByEmployee: {
        1: [{ skill_id: 1, expired_date: TOMORROW }],
        2: [{ skill_id: 1, expired_date: "2027-01-01" }],
        3: [{ skill_id: 1, expired_date: null }],
      },
      offersByEmployee: { 1: makeAccepted(1, 10), 2: makeAccepted(2, 10), 3: makeAccepted(3, 10) },
    }, mock),
  },
  {
    id: "M5",
    setup: (mock) => setupScenario({
      requiredSkillIds: [1, 2, 3, 4, 5],
      employees: [
        { id: 1, name: "Full Five", ...CBD }, { id: 2, name: "Four Of Five", ...CBD },
        { id: 3, name: "Three Of Five", ...CBD }, { id: 4, name: "Also Full Five", ...CBD },
      ],
      skillsByEmployee: {
        1: [1, 2, 3, 4, 5].map((id) => ({ skill_id: id, expired_date: null })),
        2: [1, 2, 3, 4].map((id) => ({ skill_id: id, expired_date: null })),
        3: [1, 2, 3].map((id) => ({ skill_id: id, expired_date: null })),
        4: [1, 2, 3, 4, 5].map((id) => ({ skill_id: id, expired_date: null })),
      },
      offersByEmployee: { 1: makeAccepted(1, 10), 4: makeAccepted(4, 10) },
    }, mock),
  },
  // Category 3: Rural / Sparse
  {
    id: "R1",
    setup: (mock) => setupScenario({
      clientLat: RURAL_CLIENT.lat, clientLng: RURAL_CLIENT.lng,
      employees: [{ id: 1, name: "City Alice", ...CBD }, { id: 2, name: "City Bob", ...CBD }, { id: 3, name: "City Carol", ...CBD }],
      offersByEmployee: { 1: makeAccepted(1, 10), 2: makeAccepted(2, 10), 3: makeAccepted(3, 10) },
    }, mock),
  },
  {
    id: "R2",
    setup: (mock) => setupScenario({
      clientLat: RURAL_CLIENT.lat, clientLng: RURAL_CLIENT.lng,
      employees: [{ id: 1, name: "Regional Alice", lat: -38.30, lng: 145.15 }, { id: 2, name: "Regional Bob", lat: -38.40, lng: 145.25 }],
      offersByEmployee: { 1: makeAccepted(1, 10), 2: makeAccepted(2, 10) },
    }, mock),
  },
  {
    id: "R3", preset: "efficiency",
    setup: (mock) => setupScenario({
      clientLat: RURAL_CLIENT.lat, clientLng: RURAL_CLIENT.lng,
      employees: [
        { id: 1, name: "Local Alice", lat: -38.35, lng: 145.22 },
        { id: 2, name: "Nearby Bob", lat: -38.20, lng: 145.10 },
        { id: 3, name: "Far Carol", ...CBD },
        { id: 4, name: "Mid Dave", lat: -38.10, lng: 145.00 },
      ],
      offersByEmployee: { 1: makeAccepted(1, 10), 2: makeAccepted(2, 10), 3: makeAccepted(3, 10), 4: makeAccepted(4, 10) },
    }, mock),
  },
  {
    id: "R4",
    setup: (mock) => setupScenario({
      employees: [{ id: 1, name: "Has Coords", ...CBD }, { id: 2, name: "No Coords", lat: null, lng: null }, { id: 3, name: "Also Has", ...NEAR }],
      offersByEmployee: { 1: makeAccepted(1, 10), 2: makeAccepted(2, 10), 3: makeAccepted(3, 10) },
    }, mock),
  },
  {
    id: "R5",
    setup: (mock) => setupScenario({
      clientLat: null, clientLng: null,
      employees: [{ id: 1, name: "Alice Smith", ...CBD }, { id: 2, name: "Bob Jones", ...NEAR }, { id: 3, name: "Carol Lee", ...MID }],
      offersByEmployee: { 1: makeAccepted(1, 10), 2: makeAccepted(2, 10), 3: makeAccepted(3, 10) },
    }, mock),
  },
  // Category 4: Preset Comparison
  { id: "P1", preset: "urgent", setup: presetScenarioSetup },
  { id: "P2", preset: "planned", setup: presetScenarioSetup },
  {
    id: "P3", preset: "efficiency",
    setup: (mock) => setupScenario({
      employees: [{ id: 1, name: "Near Light", ...CBD }, { id: 2, name: "Far Light", ...FAR }, { id: 3, name: "Near Heavy", ...CBD }],
      offersByEmployee: { 1: makeAccepted(1, 10), 2: makeAccepted(2, 10), 3: makeAccepted(3, 10) },
      schedulesByEmployee: {
        3: [
          { start_at: "2026-03-15T06:00:00Z", end_at: "2026-03-15T08:00:00Z", employee_id: 3 },
          { start_at: "2026-03-15T12:00:00Z", end_at: "2026-03-15T14:00:00Z", employee_id: 3 },
          { start_at: "2026-03-15T15:00:00Z", end_at: "2026-03-15T17:00:00Z", employee_id: 3 },
        ],
      },
    }, mock),
  },
  {
    id: "P4", preset: "high_value_client",
    setup: (mock) => setupScenario({
      employees: [{ id: 1, name: "Long Relationship", ...MID }, { id: 2, name: "No Relationship", ...CBD }, { id: 3, name: "Some Relationship", ...NEAR }],
      clientVisitHistory: [...makeRecentVisits(1, 20, 1), ...makeRecentVisits(3, 4, 15)],
      offersByEmployee: { 1: makeAccepted(1, 10), 2: makeAccepted(2, 10), 3: makeAccepted(3, 10) },
    }, mock),
  },
  {
    id: "P5", preset: "new_client",
    setup: (mock) => setupScenario({
      requiredSkillIds: [1, 2, 3],
      employees: [{ id: 1, name: "Highly Skilled", ...MID }, { id: 2, name: "Fewer Skills Near", ...CBD }, { id: 3, name: "Also Skilled", ...NEAR }],
      skillsByEmployee: {
        1: [1, 2, 3].map((id) => ({ skill_id: id, expired_date: null })),
        2: [1, 2, 3].map((id) => ({ skill_id: id, expired_date: null })),
        3: [1, 2, 3].map((id) => ({ skill_id: id, expired_date: null })),
      },
      clientVisitHistory: [],
      offersByEmployee: { 1: makeAccepted(1, 15), 2: makeMixed(2, 3, 7), 3: makeAccepted(3, 12) },
    }, mock),
  },
  {
    id: "P6",
    weights: { skills: 1.0, relationship: 0, proximity: 0, workload: 0, acceptance: 0 },
    setup: (mock) => setupScenario({
      requiredSkillIds: [1, 2],
      employees: [{ id: 1, name: "Far Skilled", ...FAR }, { id: 2, name: "Near Unskilled", ...CBD }, { id: 3, name: "Mid Skilled", ...MID }],
      skillsByEmployee: {
        1: [{ skill_id: 1, expired_date: null }, { skill_id: 2, expired_date: null }],
        2: [{ skill_id: 1, expired_date: null }, { skill_id: 2, expired_date: null }],
        3: [{ skill_id: 1, expired_date: null }, { skill_id: 2, expired_date: null }],
      },
      clientVisitHistory: makeRecentVisits(2, 20, 1),
      offersByEmployee: { 1: makeAccepted(1, 10), 2: makeAccepted(2, 10), 3: makeAccepted(3, 10) },
    }, mock),
  },
  // Category 5: Client Relationship
  {
    id: "N1",
    setup: (mock) => setupScenario({
      employees: [{ id: 1, name: "Alice Smith", ...CBD }, { id: 2, name: "Bob Jones", ...NEAR }, { id: 3, name: "Carol Lee", ...MID }],
      clientVisitHistory: [],
      offersByEmployee: { 1: makeAccepted(1, 10), 2: makeAccepted(2, 10), 3: makeAccepted(3, 10) },
    }, mock),
  },
  {
    id: "N2", preset: "planned",
    setup: (mock) => setupScenario({
      employees: [{ id: 1, name: "Regular Carer", ...CBD }, { id: 2, name: "Occasional Carer", ...CBD }, { id: 3, name: "New Carer", ...CBD }],
      clientVisitHistory: [...makeRecentVisits(1, 25, 1), ...makeRecentVisits(2, 5, 15)],
      offersByEmployee: { 1: makeAccepted(1, 10), 2: makeAccepted(2, 10), 3: makeAccepted(3, 10) },
    }, mock),
  },
  {
    id: "N3",
    setup: (mock) => setupScenario({
      employees: [{ id: 1, name: "Recent Carer", ...CBD }, { id: 2, name: "Stale Carer", ...CBD }, { id: 3, name: "Padding Three", ...CBD }],
      clientVisitHistory: [...makeRecentVisits(1, 10, 3), ...makeRecentVisits(2, 10, 100), ...makeRecentVisits(3, 1, 5)],
      offersByEmployee: { 1: makeAccepted(1, 10), 2: makeAccepted(2, 10), 3: makeAccepted(3, 10) },
    }, mock),
  },
  {
    id: "N4",
    setup: (mock) => setupScenario({
      clientId: null, clientLat: null, clientLng: null,
      employees: [{ id: 1, name: "Alice Smith", ...CBD }, { id: 2, name: "Bob Jones", ...NEAR }, { id: 3, name: "Carol Lee", ...MID }],
      offersByEmployee: { 1: makeAccepted(1, 10), 2: makeAccepted(2, 10), 3: makeAccepted(3, 10) },
    }, mock),
  },
  {
    id: "N5",
    setup: (mock) => setupScenario({
      employees: [{ id: 1, name: "Heavy History", ...CBD }, { id: 2, name: "Some History", ...CBD }, { id: 3, name: "Minimal History", ...CBD }],
      clientVisitHistory: [...makeRecentVisits(1, 12, 2), ...makeRecentVisits(2, 5, 3), ...makeRecentVisits(3, 1, 5)],
      offersByEmployee: { 1: makeAccepted(1, 10), 2: makeAccepted(2, 10), 3: makeAccepted(3, 10) },
    }, mock),
  },
  // Category 6: Hard Constraints
  {
    id: "H1",
    setup: (mock) => setupScenario({
      requiredSkillIds: [1, 2, 3],
      employees: [{ id: 1, name: "No Skills", ...CBD }, { id: 2, name: "Wrong Skills", ...CBD }],
      skillsByEmployee: { 1: [], 2: [{ skill_id: 4, expired_date: null }, { skill_id: 5, expired_date: null }] },
    }, mock),
  },
  {
    id: "H2",
    setup: (mock) => setupScenario({
      visitStart: "2026-03-15T09:00:00Z", visitEnd: "2026-03-15T11:00:00Z",
      employees: [{ id: 1, name: "Conflicting", ...CBD }, { id: 2, name: "Free", ...CBD }, { id: 3, name: "Also Free", ...CBD }],
      schedulesByEmployee: { 1: [{ start_at: "2026-03-15T10:00:00Z", end_at: "2026-03-15T12:00:00Z", employee_id: 1 }] },
      offersByEmployee: { 2: makeAccepted(2, 10), 3: makeAccepted(3, 10) },
    }, mock),
  },
  {
    id: "H3",
    setup: (mock) => setupScenario({
      visitStart: "2026-03-15T09:00:00Z", visitEnd: "2026-03-15T11:00:00Z",
      employees: [{ id: 1, name: "Back To Back", ...CBD }, { id: 2, name: "Also Adjacent", ...CBD }, { id: 3, name: "Free All Day", ...CBD }],
      schedulesByEmployee: {
        1: [{ start_at: "2026-03-15T07:00:00Z", end_at: "2026-03-15T09:00:00Z", employee_id: 1 }],
        2: [{ start_at: "2026-03-15T11:00:00Z", end_at: "2026-03-15T13:00:00Z", employee_id: 2 }],
      },
      offersByEmployee: { 1: makeAccepted(1, 10), 2: makeAccepted(2, 10), 3: makeAccepted(3, 10) },
    }, mock),
  },
  {
    id: "H4",
    setup: (mock) => setupScenario({
      requiredSkillIds: [1],
      employees: [{ id: 1, name: "Expired Skill", ...CBD }, { id: 2, name: "Valid Skill", ...CBD }, { id: 3, name: "Also Valid", ...CBD }],
      skillsByEmployee: {
        1: [{ skill_id: 1, expired_date: "2020-01-01" }],
        2: [{ skill_id: 1, expired_date: null }],
        3: [{ skill_id: 1, expired_date: "2027-01-01" }],
      },
      offersByEmployee: { 2: makeAccepted(2, 10), 3: makeAccepted(3, 10) },
    }, mock),
  },
  {
    id: "H5",
    setup: (mock) => setupScenario({
      requiredSkillIds: [1, 2], visitStart: "2026-03-15T09:00:00Z", visitEnd: "2026-03-15T11:00:00Z",
      employees: [{ id: 1, name: "Double Fail", ...CBD }, { id: 2, name: "Pass All", ...CBD }, { id: 3, name: "Also Pass", ...CBD }],
      skillsByEmployee: {
        1: [{ skill_id: 1, expired_date: null }],
        2: [{ skill_id: 1, expired_date: null }, { skill_id: 2, expired_date: null }],
        3: [{ skill_id: 1, expired_date: null }, { skill_id: 2, expired_date: null }],
      },
      schedulesByEmployee: { 1: [{ start_at: "2026-03-15T10:00:00Z", end_at: "2026-03-15T12:00:00Z", employee_id: 1 }] },
      offersByEmployee: { 2: makeAccepted(2, 10), 3: makeAccepted(3, 10) },
    }, mock),
  },
  {
    id: "H6",
    setup: (mock) => setupScenario({
      requiredSkillIds: [],
      employees: [{ id: 1, name: "No Skills", ...CBD }, { id: 2, name: "Some Skills", ...CBD }, { id: 3, name: "Many Skills", ...CBD }],
      skillsByEmployee: {
        1: [], 2: [{ skill_id: 1, expired_date: null }],
        3: [1, 2, 3, 4, 5].map((id) => ({ skill_id: id, expired_date: null })),
      },
      offersByEmployee: { 1: makeAccepted(1, 10), 2: makeAccepted(2, 10), 3: makeAccepted(3, 10) },
    }, mock),
  },
];
