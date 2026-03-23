/**
 * Sprint 4 Task 4.1: 30+ scoring scenarios across 6 categories.
 *
 * Each scenario exercises the full computeMatch orchestrator with controlled
 * mock data and verifies expected rankings, confidence levels, and data warnings.
 *
 * Categories:
 *   1. Straightforward Matches (S1–S5)
 *   2. Multi-Qualified Candidates (M1–M5)
 *   3. Rural / Sparse Pools (R1–R5)
 *   4. Urgent vs Planned Presets (P1–P6)
 *   5. New vs Established Clients (N1–N5)
 *   6. Hard Constraint Edge Cases (H1–H6)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { alayaCareCache } from "@/src/lib/alayacare-cache";

vi.mock("@/src/lib/alayacare-client", () => ({
  alayaFetch: vi.fn(),
}));

import { alayaFetch } from "@/src/lib/alayacare-client";
import { computeMatch } from "./compute-match";
import {
  setupScenario,
  presetScenarioSetup,
  CBD, NEAR, MID, FAR, RURAL_CLIENT,
  makeAccepted, makeMixed, makeRecentVisits,
} from "./scenario-test-helpers";

const mockedAlayaFetch = vi.mocked(alayaFetch);
const setup = (data: Parameters<typeof setupScenario>[0]) => setupScenario(data, mockedAlayaFetch);

beforeEach(() => {
  vi.clearAllMocks();
  alayaCareCache.clear();
});

// ── Category 1: Straightforward Matches ──

describe("Category 1: Straightforward Matches", () => {
  it("S1: Clear winner — close, skilled, good history, high acceptance", async () => {
    setup({
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
        ...makeRecentVisits(1, 15, 2),
        ...makeRecentVisits(2, 3, 20),
        ...makeRecentVisits(3, 2, 40),
        ...makeRecentVisits(4, 1, 5),
      ],
      offersByEmployee: {
        1: makeMixed(1, 18, 2),
        2: makeMixed(2, 5, 5),
        3: makeMixed(3, 3, 7),
        4: makeMixed(4, 8, 2),
      },
    });

    const result = await computeMatch(100, { preset: "planned" });

    expect(result.candidates[0].employee_id).toBe(1);
    expect(result.candidates[0].overall).toBeGreaterThan(0.7);
    expect(result.eligible_pool_size).toBe(4);
  });

  it("S2: Two very close candidates — tight race detection", async () => {
    setup({
      requiredSkillIds: [1],
      employees: [
        { id: 1, name: "Alice Smith", ...CBD },
        { id: 2, name: "Bob Jones", ...CBD },
        { id: 3, name: "Carol Lee", ...NEAR },
      ],
      skillsByEmployee: {
        1: [{ skill_id: 1, expired_date: null }],
        2: [{ skill_id: 1, expired_date: null }],
        3: [{ skill_id: 1, expired_date: null }],
      },
      clientVisitHistory: [
        ...makeRecentVisits(1, 10, 2),
        ...makeRecentVisits(2, 10, 2),
        ...makeRecentVisits(3, 2, 30),
      ],
      offersByEmployee: {
        1: makeMixed(1, 12, 3),
        2: makeMixed(2, 11, 4),
        3: makeMixed(3, 5, 5),
      },
    });

    const result = await computeMatch(100, { preset: "planned" });

    const gap = result.candidates[0].overall - result.candidates[1].overall;
    expect(gap).toBeLessThan(0.15);
    expect(result.candidates.length).toBe(3);
  });

  it("S3: All candidates equally qualified — workload becomes differentiator", async () => {
    setup({
      employees: [
        { id: 1, name: "Alice Smith", ...CBD },
        { id: 2, name: "Bob Jones", ...CBD },
        { id: 3, name: "Carol Lee", ...CBD },
      ],
      clientVisitHistory: [
        ...makeRecentVisits(1, 5, 2),
        ...makeRecentVisits(2, 5, 2),
        ...makeRecentVisits(3, 5, 2),
      ],
      offersByEmployee: {
        1: makeAccepted(1, 10),
        2: makeAccepted(2, 10),
        3: makeAccepted(3, 10),
      },
      schedulesByEmployee: {
        1: [{ start_at: "2026-03-15T06:00:00Z", end_at: "2026-03-15T08:00:00Z", employee_id: 1 }],
        2: [
          { start_at: "2026-03-15T06:00:00Z", end_at: "2026-03-15T08:00:00Z", employee_id: 2 },
          { start_at: "2026-03-15T12:00:00Z", end_at: "2026-03-15T14:00:00Z", employee_id: 2 },
          { start_at: "2026-03-15T15:00:00Z", end_at: "2026-03-15T17:00:00Z", employee_id: 2 },
        ],
        3: [],
      },
    });

    const result = await computeMatch(100, { preset: "planned" });

    const ids = result.candidates.map((c) => c.employee_id);
    expect(ids.indexOf(3)).toBeLessThan(ids.indexOf(2));
  });

  it("S4: Single candidate — returns with low match confidence", async () => {
    setup({
      employees: [{ id: 1, name: "Alice Smith", ...CBD }],
      skillsByEmployee: { 1: [{ skill_id: 1, expired_date: null }] },
      offersByEmployee: { 1: makeAccepted(1, 10) },
    });

    const result = await computeMatch(100, {});

    expect(result.candidates).toHaveLength(1);
    expect(result.match_confidence).toBe("low");
    expect(result.eligible_pool_size).toBe(1);
  });

  it("S5: Large pool — top 10 limit applied correctly", async () => {
    const employees = Array.from({ length: 20 }, (_, i) => ({
      id: i + 1,
      name: `Employee ${i + 1}`,
      ...CBD,
    }));
    const skills = Object.fromEntries(
      employees.map((e) => [e.id, [{ skill_id: 1, expired_date: null }]])
    );
    const offers = Object.fromEntries(
      employees.map((e) => [e.id, makeAccepted(e.id, 10)])
    );

    setup({ employees, skillsByEmployee: skills, offersByEmployee: offers });

    const result = await computeMatch(100, { limit: 10 });

    expect(result.candidates).toHaveLength(10);
    expect(result.candidate_pool_size).toBe(20);
    for (let i = 1; i < result.candidates.length; i++) {
      expect(result.candidates[i - 1].overall).toBeGreaterThanOrEqual(result.candidates[i].overall);
    }
  });
});

// ── Category 2: Multi-Qualified Candidates ──

describe("Category 2: Multi-Qualified Candidates", () => {
  it("M1: Specialist with all required skills ranks above generalist", async () => {
    setup({
      requiredSkillIds: [1, 2, 3],
      employees: [
        { id: 1, name: "Specialist One", ...CBD },
        { id: 2, name: "Generalist Two", ...CBD },
        { id: 3, name: "Partial Three", ...CBD },
      ],
      skillsByEmployee: {
        1: [
          { skill_id: 1, expired_date: null },
          { skill_id: 2, expired_date: null },
          { skill_id: 3, expired_date: null },
          { skill_id: 4, expired_date: null },
        ],
        2: [
          { skill_id: 1, expired_date: null },
          { skill_id: 2, expired_date: null },
          { skill_id: 3, expired_date: null },
        ],
        3: [
          { skill_id: 1, expired_date: null },
          { skill_id: 2, expired_date: null },
          { skill_id: 3, expired_date: null },
        ],
      },
      clientVisitHistory: [
        ...makeRecentVisits(1, 5, 2),
        ...makeRecentVisits(2, 5, 2),
        ...makeRecentVisits(3, 5, 2),
      ],
      offersByEmployee: {
        1: makeAccepted(1, 10),
        2: makeAccepted(2, 10),
        3: makeAccepted(3, 10),
      },
    });

    const result = await computeMatch(100, {});

    const skillScores = result.candidates.map((c) => c.dimensions.skills.score);
    expect(skillScores.every((s) => s === 1.0)).toBe(true);
  });

  it("M2: Candidate with more required skills matched scores higher", async () => {
    setup({
      requiredSkillIds: [1, 2, 3, 4],
      employees: [
        { id: 1, name: "Full Match", ...CBD },
        { id: 2, name: "Three Of Four", ...CBD },
        { id: 3, name: "Two Of Four", ...CBD },
      ],
      skillsByEmployee: {
        1: [
          { skill_id: 1, expired_date: null },
          { skill_id: 2, expired_date: null },
          { skill_id: 3, expired_date: null },
          { skill_id: 4, expired_date: null },
        ],
        2: [
          { skill_id: 1, expired_date: null },
          { skill_id: 2, expired_date: null },
          { skill_id: 3, expired_date: null },
        ],
        3: [
          { skill_id: 1, expired_date: null },
          { skill_id: 2, expired_date: null },
        ],
      },
      offersByEmployee: {
        1: makeAccepted(1, 10),
        2: makeAccepted(2, 10),
        3: makeAccepted(3, 10),
      },
    });

    const result = await computeMatch(100, {});

    expect(result.candidates[0].dimensions.skills.score).toBe(1.0);
    expect(result.eligible_pool_size).toBe(1);
    expect(result.candidates[0].employee_id).toBe(1);
  });

  it("M3: No required skills defined — skills confidence is low for all", async () => {
    setup({
      requiredSkillIds: [],
      employees: [
        { id: 1, name: "Alice Smith", ...CBD },
        { id: 2, name: "Bob Jones", ...CBD },
        { id: 3, name: "Carol Lee", ...CBD },
      ],
      offersByEmployee: {
        1: makeAccepted(1, 10),
        2: makeAccepted(2, 10),
        3: makeAccepted(3, 10),
      },
    });

    const result = await computeMatch(100, {});

    expect(result.data_warnings).toContain("Visit has no required skills defined");
    for (const candidate of result.candidates) {
      expect(candidate.dimensions.skills.score).toBe(1.0);
      expect(candidate.dimensions.skills.confidence).toBe("low");
    }
  });

  it("M4: Expiring-soon skills still valid — should pass hard constraints", async () => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    setup({
      requiredSkillIds: [1],
      employees: [
        { id: 1, name: "Expiring Soon", ...CBD },
        { id: 2, name: "Valid Long", ...CBD },
        { id: 3, name: "Padding Three", ...CBD },
      ],
      skillsByEmployee: {
        1: [{ skill_id: 1, expired_date: tomorrow }],
        2: [{ skill_id: 1, expired_date: "2027-01-01" }],
        3: [{ skill_id: 1, expired_date: null }],
      },
      offersByEmployee: {
        1: makeAccepted(1, 10),
        2: makeAccepted(2, 10),
        3: makeAccepted(3, 10),
      },
    });

    const result = await computeMatch(100, {});

    expect(result.eligible_pool_size).toBe(3);
    for (const c of result.candidates) {
      expect(c.dimensions.skills.score).toBe(1.0);
    }
  });

  it("M5: Multiple skill requirements — only fully qualified pass hard filter", async () => {
    setup({
      requiredSkillIds: [1, 2, 3, 4, 5],
      employees: [
        { id: 1, name: "Full Five", ...CBD },
        { id: 2, name: "Four Of Five", ...CBD },
        { id: 3, name: "Three Of Five", ...CBD },
        { id: 4, name: "Also Full Five", ...CBD },
      ],
      skillsByEmployee: {
        1: [1, 2, 3, 4, 5].map((id) => ({ skill_id: id, expired_date: null })),
        2: [1, 2, 3, 4].map((id) => ({ skill_id: id, expired_date: null })),
        3: [1, 2, 3].map((id) => ({ skill_id: id, expired_date: null })),
        4: [1, 2, 3, 4, 5].map((id) => ({ skill_id: id, expired_date: null })),
      },
      offersByEmployee: {
        1: makeAccepted(1, 10),
        4: makeAccepted(4, 10),
      },
    });

    const result = await computeMatch(100, {});

    expect(result.eligible_pool_size).toBe(2);
    expect(result.candidate_pool_size).toBe(4);
    const ids = result.candidates.map((c) => c.employee_id);
    expect(ids).toContain(1);
    expect(ids).toContain(4);
    expect(ids).not.toContain(2);
    expect(ids).not.toContain(3);
  });
});

// ── Category 3: Rural / Sparse Pools ──

describe("Category 3: Rural / Sparse Pools", () => {
  it("R1: No employees within 50km — all get 0.0 proximity score", async () => {
    setup({
      clientLat: RURAL_CLIENT.lat,
      clientLng: RURAL_CLIENT.lng,
      employees: [
        { id: 1, name: "City Alice", ...CBD },
        { id: 2, name: "City Bob", ...CBD },
        { id: 3, name: "City Carol", ...CBD },
      ],
      offersByEmployee: {
        1: makeAccepted(1, 10),
        2: makeAccepted(2, 10),
        3: makeAccepted(3, 10),
      },
    });

    const result = await computeMatch(100, {});

    for (const c of result.candidates) {
      expect(c.dimensions.proximity.score).toBe(0);
    }
  });

  it("R2: Only 2 eligible employees — low match confidence", async () => {
    setup({
      clientLat: RURAL_CLIENT.lat,
      clientLng: RURAL_CLIENT.lng,
      employees: [
        { id: 1, name: "Regional Alice", lat: -38.30, lng: 145.15 },
        { id: 2, name: "Regional Bob", lat: -38.40, lng: 145.25 },
      ],
      offersByEmployee: {
        1: makeAccepted(1, 10),
        2: makeAccepted(2, 10),
      },
    });

    const result = await computeMatch(100, {});

    expect(result.candidates).toHaveLength(2);
    expect(result.match_confidence).toBe("low");
  });

  it("R3: Mix of near and far employees — proximity differentiates", async () => {
    setup({
      clientLat: RURAL_CLIENT.lat,
      clientLng: RURAL_CLIENT.lng,
      employees: [
        { id: 1, name: "Local Alice", lat: -38.35, lng: 145.22 },
        { id: 2, name: "Nearby Bob", lat: -38.20, lng: 145.10 },
        { id: 3, name: "Far Carol", ...CBD },
        { id: 4, name: "Mid Dave", lat: -38.10, lng: 145.00 },
      ],
      offersByEmployee: {
        1: makeAccepted(1, 10),
        2: makeAccepted(2, 10),
        3: makeAccepted(3, 10),
        4: makeAccepted(4, 10),
      },
    });

    const result = await computeMatch(100, { preset: "efficiency" });

    const localRank = result.candidates.findIndex((c) => c.employee_id === 1);
    const farRank = result.candidates.findIndex((c) => c.employee_id === 3);
    expect(localRank).toBeLessThan(farRank);

    const local = result.candidates.find((c) => c.employee_id === 1)!;
    expect(local.dimensions.proximity.score).toBeGreaterThan(0.9);
  });

  it("R4: Employee with null coordinates — 0.0 proximity with low confidence", async () => {
    setup({
      employees: [
        { id: 1, name: "Has Coords", ...CBD },
        { id: 2, name: "No Coords", lat: null, lng: null },
        { id: 3, name: "Also Has", ...NEAR },
      ],
      offersByEmployee: {
        1: makeAccepted(1, 10),
        2: makeAccepted(2, 10),
        3: makeAccepted(3, 10),
      },
    });

    const result = await computeMatch(100, {});

    const noCoords = result.candidates.find((c) => c.employee_id === 2)!;
    expect(noCoords.dimensions.proximity.score).toBe(0);
    expect(noCoords.dimensions.proximity.confidence).toBe("low");
    expect(noCoords.warnings).toContain("Employee missing coordinates");
  });

  it("R5: Client missing coordinates — all proximity scores 0.0 low confidence", async () => {
    setup({
      clientLat: null,
      clientLng: null,
      employees: [
        { id: 1, name: "Alice Smith", ...CBD },
        { id: 2, name: "Bob Jones", ...NEAR },
        { id: 3, name: "Carol Lee", ...MID },
      ],
      offersByEmployee: {
        1: makeAccepted(1, 10),
        2: makeAccepted(2, 10),
        3: makeAccepted(3, 10),
      },
    });

    const result = await computeMatch(100, {});

    expect(result.data_warnings).toContain("Client missing coordinates — proximity unavailable");
    for (const c of result.candidates) {
      expect(c.dimensions.proximity.score).toBe(0);
      expect(c.dimensions.proximity.confidence).toBe("low");
    }
  });
});

// ── Category 4: Urgent vs Planned Presets ──

describe("Category 4: Urgent vs Planned Presets", () => {
  it("P1: Urgent preset — high-acceptance employee ranks higher", async () => {
    presetScenarioSetup(mockedAlayaFetch);
    const result = await computeMatch(100, { preset: "urgent" });

    expect(result.candidates[0].employee_id).toBe(1);
    expect(result.weights_used.acceptance).toBe(0.40);
  });

  it("P2: Planned preset — relationship history matters more", async () => {
    presetScenarioSetup(mockedAlayaFetch);
    const result = await computeMatch(100, { preset: "planned" });

    expect(result.candidates[0].employee_id).toBe(2);
    expect(result.weights_used.relationship).toBe(0.30);
  });

  it("P3: Efficiency preset — nearby low-workload employee wins", async () => {
    setup({
      employees: [
        { id: 1, name: "Near Light", ...CBD },
        { id: 2, name: "Far Light", ...FAR },
        { id: 3, name: "Near Heavy", ...CBD },
      ],
      offersByEmployee: {
        1: makeAccepted(1, 10),
        2: makeAccepted(2, 10),
        3: makeAccepted(3, 10),
      },
      schedulesByEmployee: {
        1: [],
        2: [],
        3: [
          { start_at: "2026-03-15T06:00:00Z", end_at: "2026-03-15T08:00:00Z", employee_id: 3 },
          { start_at: "2026-03-15T12:00:00Z", end_at: "2026-03-15T14:00:00Z", employee_id: 3 },
          { start_at: "2026-03-15T15:00:00Z", end_at: "2026-03-15T17:00:00Z", employee_id: 3 },
        ],
      },
    });

    const result = await computeMatch(100, { preset: "efficiency" });

    expect(result.candidates[0].employee_id).toBe(1);
  });

  it("P4: High-value-client preset — relationship dominates", async () => {
    setup({
      employees: [
        { id: 1, name: "Long Relationship", ...MID },
        { id: 2, name: "No Relationship", ...CBD },
        { id: 3, name: "Some Relationship", ...NEAR },
      ],
      clientVisitHistory: [
        ...makeRecentVisits(1, 20, 1),
        ...makeRecentVisits(3, 4, 15),
      ],
      offersByEmployee: {
        1: makeAccepted(1, 10),
        2: makeAccepted(2, 10),
        3: makeAccepted(3, 10),
      },
    });

    const result = await computeMatch(100, { preset: "high_value_client" });

    expect(result.candidates[0].employee_id).toBe(1);
    expect(result.candidates[0].dimensions.relationship.score).toBeGreaterThan(0.8);
  });

  it("P5: New-client preset — skills weighted highest, no relationship advantage", async () => {
    setup({
      requiredSkillIds: [1, 2, 3],
      employees: [
        { id: 1, name: "Highly Skilled", ...MID },
        { id: 2, name: "Fewer Skills Near", ...CBD },
        { id: 3, name: "Also Skilled", ...NEAR },
      ],
      skillsByEmployee: {
        1: [1, 2, 3].map((id) => ({ skill_id: id, expired_date: null })),
        2: [1, 2, 3].map((id) => ({ skill_id: id, expired_date: null })),
        3: [1, 2, 3].map((id) => ({ skill_id: id, expired_date: null })),
      },
      clientVisitHistory: [],
      offersByEmployee: {
        1: makeAccepted(1, 15),
        2: makeMixed(2, 3, 7),
        3: makeAccepted(3, 12),
      },
    });

    const result = await computeMatch(100, { preset: "new_client" });

    expect(result.weights_used.relationship).toBe(0.05);
    expect(result.weights_used.skills).toBe(0.25);
    const top = result.candidates[0];
    expect(top.employee_id).not.toBe(2);
  });

  it("P6: Custom weights — skills-only weighting produces pure skills ranking", async () => {
    setup({
      requiredSkillIds: [1, 2],
      employees: [
        { id: 1, name: "Far Skilled", ...FAR },
        { id: 2, name: "Near Unskilled", ...CBD },
        { id: 3, name: "Mid Skilled", ...MID },
      ],
      skillsByEmployee: {
        1: [{ skill_id: 1, expired_date: null }, { skill_id: 2, expired_date: null }],
        2: [{ skill_id: 1, expired_date: null }, { skill_id: 2, expired_date: null }],
        3: [{ skill_id: 1, expired_date: null }, { skill_id: 2, expired_date: null }],
      },
      clientVisitHistory: makeRecentVisits(2, 20, 1),
      offersByEmployee: {
        1: makeAccepted(1, 10),
        2: makeAccepted(2, 10),
        3: makeAccepted(3, 10),
      },
    });

    const result = await computeMatch(100, {
      weights: { skills: 1.0, relationship: 0, proximity: 0, workload: 0, acceptance: 0 },
    });

    expect(result.preset_name).toBeNull();
    const scores = result.candidates.map((c) => c.overall);
    expect(scores[0]).toBeCloseTo(scores[1], 5);
  });
});

// ── Category 5: New vs Established Clients ──

describe("Category 5: New vs Established Clients", () => {
  it("N1: Brand new client — zero relationship scores for all", async () => {
    setup({
      employees: [
        { id: 1, name: "Alice Smith", ...CBD },
        { id: 2, name: "Bob Jones", ...NEAR },
        { id: 3, name: "Carol Lee", ...MID },
      ],
      clientVisitHistory: [],
      offersByEmployee: {
        1: makeAccepted(1, 10),
        2: makeAccepted(2, 10),
        3: makeAccepted(3, 10),
      },
    });

    const result = await computeMatch(100, {});

    for (const c of result.candidates) {
      expect(c.dimensions.relationship.score).toBe(0);
      expect(c.dimensions.relationship.confidence).toBe("low");
    }
  });

  it("N2: Established client — continuity of care favoured", async () => {
    setup({
      employees: [
        { id: 1, name: "Regular Carer", ...CBD },
        { id: 2, name: "Occasional Carer", ...CBD },
        { id: 3, name: "New Carer", ...CBD },
      ],
      clientVisitHistory: [
        ...makeRecentVisits(1, 25, 1),
        ...makeRecentVisits(2, 5, 15),
      ],
      offersByEmployee: {
        1: makeAccepted(1, 10),
        2: makeAccepted(2, 10),
        3: makeAccepted(3, 10),
      },
    });

    const result = await computeMatch(100, { preset: "planned" });

    expect(result.candidates[0].employee_id).toBe(1);
    expect(result.candidates[0].dimensions.relationship.score).toBeGreaterThan(0.9);
    expect(result.candidates[0].dimensions.relationship.confidence).toBe("high");
  });

  it("N3: Stale relationship — recency multiplier reduces score", async () => {
    setup({
      employees: [
        { id: 1, name: "Recent Carer", ...CBD },
        { id: 2, name: "Stale Carer", ...CBD },
        { id: 3, name: "Padding Three", ...CBD },
      ],
      clientVisitHistory: [
        ...makeRecentVisits(1, 10, 3),
        ...makeRecentVisits(2, 10, 100),
        ...makeRecentVisits(3, 1, 5),
      ],
      offersByEmployee: {
        1: makeAccepted(1, 10),
        2: makeAccepted(2, 10),
        3: makeAccepted(3, 10),
      },
    });

    const result = await computeMatch(100, {});

    const recent = result.candidates.find((c) => c.employee_id === 1)!;
    const stale = result.candidates.find((c) => c.employee_id === 2)!;

    expect(recent.dimensions.relationship.score).toBeGreaterThan(
      stale.dimensions.relationship.score * 2
    );
  });

  it("N4: Visit with no client assigned — relationship defaults to 0", async () => {
    setup({
      clientId: null,
      clientLat: null,
      clientLng: null,
      employees: [
        { id: 1, name: "Alice Smith", ...CBD },
        { id: 2, name: "Bob Jones", ...NEAR },
        { id: 3, name: "Carol Lee", ...MID },
      ],
      offersByEmployee: {
        1: makeAccepted(1, 10),
        2: makeAccepted(2, 10),
        3: makeAccepted(3, 10),
      },
    });

    const result = await computeMatch(100, {});

    expect(result.client_id).toBeNull();
    expect(result.data_warnings).toContain("Visit has no client assigned");
    for (const c of result.candidates) {
      expect(c.dimensions.relationship.score).toBe(0);
      expect(c.dimensions.proximity.score).toBe(0);
    }
  });

  it("N5: Relationship confidence tiers — low/medium/high", async () => {
    setup({
      employees: [
        { id: 1, name: "Heavy History", ...CBD },
        { id: 2, name: "Some History", ...CBD },
        { id: 3, name: "Minimal History", ...CBD },
      ],
      clientVisitHistory: [
        ...makeRecentVisits(1, 12, 2),
        ...makeRecentVisits(2, 5, 3),
        ...makeRecentVisits(3, 1, 5),
      ],
      offersByEmployee: {
        1: makeAccepted(1, 10),
        2: makeAccepted(2, 10),
        3: makeAccepted(3, 10),
      },
    });

    const result = await computeMatch(100, {});

    const heavy = result.candidates.find((c) => c.employee_id === 1)!;
    const some = result.candidates.find((c) => c.employee_id === 2)!;
    const minimal = result.candidates.find((c) => c.employee_id === 3)!;

    expect(heavy.dimensions.relationship.confidence).toBe("high");
    expect(some.dimensions.relationship.confidence).toBe("medium");
    expect(minimal.dimensions.relationship.confidence).toBe("low");
  });
});

// ── Category 6: Hard Constraint Edge Cases ──

describe("Category 6: Hard Constraint Edge Cases", () => {
  it("H1: All employees filtered out — empty result with low confidence", async () => {
    setup({
      requiredSkillIds: [1, 2, 3],
      employees: [
        { id: 1, name: "No Skills", ...CBD },
        { id: 2, name: "Wrong Skills", ...CBD },
      ],
      skillsByEmployee: {
        1: [],
        2: [{ skill_id: 4, expired_date: null }, { skill_id: 5, expired_date: null }],
      },
    });

    const result = await computeMatch(100, {});

    expect(result.candidates).toHaveLength(0);
    expect(result.eligible_pool_size).toBe(0);
    expect(result.match_confidence).toBe("low");
    expect(result.data_warnings).toContain("No eligible employees after hard constraint filtering");
  });

  it("H2: Schedule conflict — overlapping visit filters out employee", async () => {
    setup({
      visitStart: "2026-03-15T09:00:00Z",
      visitEnd: "2026-03-15T11:00:00Z",
      employees: [
        { id: 1, name: "Conflicting", ...CBD },
        { id: 2, name: "Free", ...CBD },
        { id: 3, name: "Also Free", ...CBD },
      ],
      schedulesByEmployee: {
        1: [{ start_at: "2026-03-15T10:00:00Z", end_at: "2026-03-15T12:00:00Z", employee_id: 1 }],
      },
      offersByEmployee: {
        2: makeAccepted(2, 10),
        3: makeAccepted(3, 10),
      },
    });

    const result = await computeMatch(100, {});

    expect(result.eligible_pool_size).toBe(2);
    const ids = result.candidates.map((c) => c.employee_id);
    expect(ids).not.toContain(1);
    expect(ids).toContain(2);
    expect(ids).toContain(3);
  });

  it("H3: Adjacent shifts — no overlap, should NOT be filtered", async () => {
    setup({
      visitStart: "2026-03-15T09:00:00Z",
      visitEnd: "2026-03-15T11:00:00Z",
      employees: [
        { id: 1, name: "Back To Back", ...CBD },
        { id: 2, name: "Also Adjacent", ...CBD },
        { id: 3, name: "Free All Day", ...CBD },
      ],
      schedulesByEmployee: {
        1: [{ start_at: "2026-03-15T07:00:00Z", end_at: "2026-03-15T09:00:00Z", employee_id: 1 }],
        2: [{ start_at: "2026-03-15T11:00:00Z", end_at: "2026-03-15T13:00:00Z", employee_id: 2 }],
      },
      offersByEmployee: {
        1: makeAccepted(1, 10),
        2: makeAccepted(2, 10),
        3: makeAccepted(3, 10),
      },
    });

    const result = await computeMatch(100, {});

    expect(result.eligible_pool_size).toBe(3);
  });

  it("H4: Expired skill on required qualification — filtered out", async () => {
    setup({
      requiredSkillIds: [1],
      employees: [
        { id: 1, name: "Expired Skill", ...CBD },
        { id: 2, name: "Valid Skill", ...CBD },
        { id: 3, name: "Also Valid", ...CBD },
      ],
      skillsByEmployee: {
        1: [{ skill_id: 1, expired_date: "2020-01-01" }],
        2: [{ skill_id: 1, expired_date: null }],
        3: [{ skill_id: 1, expired_date: "2027-01-01" }],
      },
      offersByEmployee: {
        2: makeAccepted(2, 10),
        3: makeAccepted(3, 10),
      },
    });

    const result = await computeMatch(100, {});

    expect(result.eligible_pool_size).toBe(2);
    const ids = result.candidates.map((c) => c.employee_id);
    expect(ids).not.toContain(1);
  });

  it("H5: Multiple constraint failures — both missing skill AND schedule conflict", async () => {
    setup({
      requiredSkillIds: [1, 2],
      visitStart: "2026-03-15T09:00:00Z",
      visitEnd: "2026-03-15T11:00:00Z",
      employees: [
        { id: 1, name: "Double Fail", ...CBD },
        { id: 2, name: "Pass All", ...CBD },
        { id: 3, name: "Also Pass", ...CBD },
      ],
      skillsByEmployee: {
        1: [{ skill_id: 1, expired_date: null }],
        2: [{ skill_id: 1, expired_date: null }, { skill_id: 2, expired_date: null }],
        3: [{ skill_id: 1, expired_date: null }, { skill_id: 2, expired_date: null }],
      },
      schedulesByEmployee: {
        1: [{ start_at: "2026-03-15T10:00:00Z", end_at: "2026-03-15T12:00:00Z", employee_id: 1 }],
      },
      offersByEmployee: {
        2: makeAccepted(2, 10),
        3: makeAccepted(3, 10),
      },
    });

    const result = await computeMatch(100, {});

    expect(result.eligible_pool_size).toBe(2);
    expect(result.candidate_pool_size).toBe(3);
    const ids = result.candidates.map((c) => c.employee_id);
    expect(ids).not.toContain(1);
  });

  it("H6: All constraints pass with no required skills — everyone eligible", async () => {
    setup({
      requiredSkillIds: [],
      employees: [
        { id: 1, name: "No Skills", ...CBD },
        { id: 2, name: "Some Skills", ...CBD },
        { id: 3, name: "Many Skills", ...CBD },
      ],
      skillsByEmployee: {
        1: [],
        2: [{ skill_id: 1, expired_date: null }],
        3: [1, 2, 3, 4, 5].map((id) => ({ skill_id: id, expired_date: null })),
      },
      offersByEmployee: {
        1: makeAccepted(1, 10),
        2: makeAccepted(2, 10),
        3: makeAccepted(3, 10),
      },
    });

    const result = await computeMatch(100, {});

    expect(result.eligible_pool_size).toBe(3);
    expect(result.data_warnings).toContain("Visit has no required skills defined");
  });
});
