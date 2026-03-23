import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WeightConfig } from "./types";
import type { AlayaRequestOptions } from "@/src/lib/alayacare-client";
import { alayaCareCache } from "@/src/lib/alayacare-cache";

// Mock alayaFetch at module level
vi.mock("@/src/lib/alayacare-client", () => ({
  alayaFetch: vi.fn(),
}));

import { alayaFetch } from "@/src/lib/alayacare-client";
import { computeMatch } from "./compute-match";

const mockedAlayaFetch = vi.mocked(alayaFetch);

// Test data
const visit = {
  id: 100,
  client_id: 10,
  start_at: "2026-03-11T09:00:00Z",
  end_at: "2026-03-11T11:00:00Z",
  status: "unfilled",
};

const employees = [
  {
    id: 1,
    username: "alice",
    status: "active",
    latitude: -33.8688,
    longitude: 151.2093,
    demographics: { first_name: "Alice", last_name: "Smith" },
  },
  {
    id: 2,
    username: "bob",
    status: "active",
    latitude: -33.87,
    longitude: 151.21,
    demographics: { first_name: "Bob", last_name: "Jones" },
  },
  {
    id: 3,
    username: "carol",
    status: "active",
    latitude: -33.87,
    longitude: 151.21,
    demographics: { first_name: "Carol", last_name: "Lee" },
  },
];

const client = {
  id: 10,
  latitude: -33.8688,
  longitude: 151.2093,
};

function getSearchParam(
  options: AlayaRequestOptions | undefined,
  key: string
): string | null {
  if (!options?.searchParams) return null;
  if (options.searchParams instanceof URLSearchParams) {
    return options.searchParams.get(key);
  }
  return (options.searchParams as Record<string, string>)[key] ?? null;
}

function setupMocks(overrides: Record<string, unknown> = {}) {
  mockedAlayaFetch.mockImplementation(
    async (path: string, options?: AlayaRequestOptions) => {
      // Visit detail
      if (path === "/scheduler/visits/100") {
        return overrides.visit ?? visit;
      }
      // Client detail
      if (path.startsWith("/patients/clients/")) {
        return overrides.client ?? client;
      }
      // Employee skills (per-employee)
      if (path.match(/\/employees\/employees\/\d+\/skills/)) {
        const empId = Number(path.match(/\/employees\/employees\/(\d+)\/skills/)?.[1]);
        const allSkills = (overrides.skillsByEmployee as Record<
          number,
          unknown[]
        >) ?? {
          1: [
            { skill_id: 10, expired_date: null },
            { skill_id: 20, expired_date: null },
          ],
          2: [
            { skill_id: 10, expired_date: null },
            { skill_id: 20, expired_date: null },
          ],
          3: [
            { skill_id: 10, expired_date: null },
            { skill_id: 20, expired_date: null },
          ],
        };
        return {
          items: allSkills[empId] ?? [],
          count: (allSkills[empId] ?? []).length,
        };
      }
      // Employee list
      if (path === "/employees") {
        return (
          overrides.employees ?? { items: employees, count: employees.length }
        );
      }
      // Schedules vs client visit history (same path, different params)
      if (path === "/scheduler/visits") {
        const dateParam = getSearchParam(options, "date");
        const clientParam = getSearchParam(options, "client_id");
        if (dateParam) {
          return overrides.schedules ?? { items: [], count: 0 };
        }
        if (clientParam) {
          return overrides.clientVisitHistory ?? { items: [], count: 0 };
        }
        return { items: [], count: 0 };
      }
      // Visit offers
      if (path === "/scheduler/visit_offers") {
        return overrides.offers ?? { items: [], count: 0 };
      }
      throw new Error(`Unexpected alayaFetch path: ${path}`);
    }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  alayaCareCache.clear(); // Ensure no stale data between tests
});

describe("computeMatch", () => {
  it("should return ranked candidates with correct structure", async () => {
    setupMocks();

    const result = await computeMatch(100, {});

    expect(result.visit_id).toBe(100);
    expect(result.client_id).toBe(10);
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates[0]).toHaveProperty("employee_id");
    expect(result.candidates[0]).toHaveProperty("overall");
    expect(result.candidates[0]).toHaveProperty("dimensions");
    expect(result.candidates[0]).toHaveProperty("confidence");
    expect(result.scored_at).toBeDefined();
  });

  it("should sort candidates by overall score descending", async () => {
    setupMocks();

    const result = await computeMatch(100, {});

    for (let i = 1; i < result.candidates.length; i++) {
      expect(result.candidates[i - 1].overall).toBeGreaterThanOrEqual(
        result.candidates[i].overall
      );
    }
  });

  it("should apply weight preset", async () => {
    setupMocks();

    const result = await computeMatch(100, { preset: "urgent" });

    expect(result.preset_name).toBe("urgent");
    expect(result.weights_used.acceptance).toBe(0.40);
  });

  it("should apply custom weights", async () => {
    setupMocks();

    const weights: WeightConfig = {
      skills: 0.5,
      relationship: 0.1,
      proximity: 0.1,
      workload: 0.2,
      acceptance: 0.1,
    };
    const result = await computeMatch(100, { weights });

    expect(result.weights_used).toEqual(weights);
    expect(result.preset_name).toBeNull();
  });

  it("should enforce limit", async () => {
    setupMocks();

    const result = await computeMatch(100, { limit: 1 });

    expect(result.candidates).toHaveLength(1);
  });

  it("should filter out employees failing hard constraints", async () => {
    setupMocks({
      skillsByEmployee: {
        1: [{ skill_id: 10, expired_date: null }], // missing skill 20
        2: [
          { skill_id: 10, expired_date: null },
          { skill_id: 20, expired_date: null },
        ],
        3: [
          { skill_id: 10, expired_date: null },
          { skill_id: 20, expired_date: null },
        ],
      },
      visit: { ...visit, required_skill_ids: [10, 20] },
    });

    const result = await computeMatch(100, {});

    expect(result.candidate_pool_size).toBe(3);
    expect(result.eligible_pool_size).toBe(2);
    const employeeIds = result.candidates.map((c) => c.employee_id);
    expect(employeeIds).not.toContain(1);
  });

  it("should propagate AlayaCare API errors", async () => {
    mockedAlayaFetch.mockRejectedValue(
      new Error("AlayaCare API error: 500 Internal Server Error")
    );

    await expect(computeMatch(100, {})).rejects.toThrow("AlayaCare API error");
  });

  it("should warn when employees have no skills on file", async () => {
    setupMocks({
      skillsByEmployee: {
        1: [],
        2: [{ skill_id: 10, expired_date: null }],
        3: [],
      },
    });

    const result = await computeMatch(100, {});

    expect(result.data_warnings).toContain(
      "2 employees have no skills on file"
    );
  });

  it("should warn when visit has no client_id", async () => {
    setupMocks({
      visit: { ...visit, client_id: null },
      client: { id: 0, latitude: null, longitude: null },
    });

    // client_id null should trigger a warning. The orchestrator will
    // still proceed (using null client_id) but warn about it.
    const result = await computeMatch(100, {});

    expect(result.data_warnings).toContain("Visit has no client assigned");
  });

  it("should filter out inactive employees from candidates but bulk-fetch skills for all returned by API", async () => {
    // Note: in production, the API filter (status=active) would exclude inactive/on_leave employees.
    // This test verifies the scoring pipeline's internal status filtering works correctly
    // when the API returns employees of mixed status (defensive filtering).
    const mixedEmployees = [
      { ...employees[0], id: 1, status: "active" },
      { ...employees[1], id: 2, status: "inactive" },
      { ...employees[2], id: 3, status: "on_leave" },
    ];
    setupMocks({
      employees: { items: mixedEmployees, count: 3 },
    });

    const result = await computeMatch(100, {});

    // Only employee 1 (active) should be a candidate
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].employee_id).toBe(1);
    expect(result.candidate_pool_size).toBe(3);
    // Skills are bulk-fetched for ALL employees returned by the API (cached together)
    const skillsCalls = mockedAlayaFetch.mock.calls.filter(
      ([path]) => typeof path === "string" && path.includes("/skills")
    );
    expect(skillsCalls).toHaveLength(3);
    expect(result.data_warnings).toContain("2 employees filtered (inactive/on_leave)");
  });

  it("should exclude schedule-conflicted employees from candidates", async () => {
    setupMocks({
      schedules: {
        items: [
          // Employee 2 has a schedule conflict
          { employee_id: 2, start_at: "2026-03-11T08:00:00Z", end_at: "2026-03-11T10:00:00Z" },
        ],
        count: 1,
      },
    });

    const result = await computeMatch(100, {});

    // Employee 2 should be filtered out (schedule conflict)
    expect(result.candidates.map((c) => c.employee_id)).not.toContain(2);
    // Skills are bulk-fetched and cached for ALL active employees
    const skillsCalls = mockedAlayaFetch.mock.calls.filter(
      ([path]) => typeof path === "string" && path.includes("/skills")
    );
    expect(skillsCalls).toHaveLength(3); // all 3 active employees
  });

  it("should reuse cached employee roster on second scoring call", async () => {
    setupMocks();

    // First call — warms cache
    await computeMatch(100, {});
    const callsAfterFirst = mockedAlayaFetch.mock.calls.length;

    // Second call — employee list + skills should come from cache
    await computeMatch(100, {});
    const callsAfterSecond = mockedAlayaFetch.mock.calls.length;

    // Second call should NOT re-fetch /employees or /employees/*/skills
    // It should only fetch visit-specific data (visit detail, client, schedules, history, offers)
    const newCalls = callsAfterSecond - callsAfterFirst;
    const employeeCalls = mockedAlayaFetch.mock.calls
      .slice(callsAfterFirst)
      .filter(([path]) =>
        typeof path === "string" &&
        (path === "/employees" || path.includes("/skills"))
      );
    expect(employeeCalls).toHaveLength(0);
    // Visit-specific calls: visit detail + client + schedules + history + offers = 5
    expect(newCalls).toBe(5);
  });

  it("should return low confidence for empty eligible pool", async () => {
    setupMocks({
      employees: { items: [], count: 0 },
    });

    const result = await computeMatch(100, {});

    expect(result.candidates).toHaveLength(0);
    expect(result.match_confidence).toBe("low");
    expect(result.eligible_pool_size).toBe(0);
  });
});
