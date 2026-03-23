import { alayaFetch, type AlayaPaginatedResponse } from "@/src/lib/alayacare-client";
import {
  alayaCareCache,
  CACHE_KEY_EMPLOYEE_ROSTER,
} from "@/src/lib/alayacare-cache";
import type {
  WeightConfig,
  MatchResult,
  ScoredCandidate,
  DimensionBreakdown,
  DimensionScore,
} from "./types";
import { WEIGHT_PRESETS, DEFAULT_PRESET, type PresetName } from "./weights";
import { checkScheduleConflicts, checkSkillQualifications } from "./constraints";
import { scoreSkills } from "./score-skills";
import { scoreRelationship } from "./score-relationship";
import { scoreProximity } from "./score-proximity";
import { scoreWorkload } from "./score-workload";
import { scoreAcceptance } from "./score-acceptance";
import { computeMatchConfidence } from "./match-confidence";

export interface MatchConfig {
  weights?: WeightConfig;
  preset?: PresetName;
  limit?: number;
}

interface VisitDetail {
  id: number;
  client_id: number | null;
  start_at: string;
  end_at: string;
  required_skill_ids?: number[];
  status?: string;
  service_instructions?: string | null;
}

interface EmployeeDetail {
  id: number;
  username: string;
  status: string;
  latitude: number | null;
  longitude: number | null;
  demographics: { first_name: string; last_name: string };
}

interface SkillDetail {
  skill_id: number;
  expired_date: string | null;
}

interface ScheduleVisit {
  start_at: string;
  end_at: string;
  employee_id: number;
}

interface VisitHistoryItem {
  employee_id: number;
  start_at: string;
}

interface OfferItem {
  employee_id: number;
  status: string;
}

interface ClientDetail {
  id: number;
  latitude: number | null;
  longitude: number | null;
  first_name?: string;
  last_name?: string;
  city?: string | null;
  state?: string | null;
}

/** Cached employee roster: active employees + their skills (bulk-fetched). */
interface EmployeeRoster {
  employees: EmployeeDetail[];
  skillsByEmployeeId: Map<number, SkillDetail[]>;
}

/**
 * Fetch the employee roster (all active employees + all their skills) from
 * cache. On miss, fetches the employee list and all skills in parallel,
 * then caches the result for 30s.
 *
 * This replaces the N+1 per-employee skills fetch with a single cached
 * bulk operation. In a burst of 20 scoring calls within 30s:
 *  - First call: 1 employee list fetch + N parallel skills fetches (cached)
 *  - Calls 2–20: 0 API calls (cache hit)
 */
async function getEmployeeRoster(): Promise<EmployeeRoster> {
  return alayaCareCache.getOrFetch<EmployeeRoster>(
    CACHE_KEY_EMPLOYEE_ROSTER,
    async () => {
      const employeeList = await alayaFetch<
        AlayaPaginatedResponse<EmployeeDetail>
      >("/employees", { searchParams: { status: "active" } });

      // Bulk-fetch skills for ALL active employees in parallel.
      // This is still N calls on a cold cache, but the result is cached
      // and shared across all subsequent scoring calls within the TTL.
      const skillsResults = await Promise.all(
        employeeList.items.map((emp) =>
          alayaFetch<AlayaPaginatedResponse<SkillDetail>>(
            `/employees/employees/${emp.id}/skills`,
          ).then((r) => ({ empId: emp.id, skills: r.items })),
        ),
      );

      const skillsByEmployeeId = new Map<number, SkillDetail[]>();
      for (const { empId, skills } of skillsResults) {
        skillsByEmployeeId.set(empId, skills);
      }

      return { employees: employeeList.items, skillsByEmployeeId };
    },
  );
}

/**
 * Scoring orchestrator: fetches data, filters, scores, and ranks candidates.
 * 4 phases: Bulk Data Fetch → Hard Constraint Filter → Multi-Factor Scoring → Ranking + Confidence.
 */
export async function computeMatch(
  visitId: number,
  config: MatchConfig
): Promise<MatchResult> {
  const now = new Date();

  // Resolve weights
  const presetName = config.weights ? null : (config.preset ?? DEFAULT_PRESET);
  const weights: WeightConfig = config.weights ?? WEIGHT_PRESETS[presetName as PresetName];

  // ── Phase 1: Bulk Data Fetch ──
  // Visit detail must be fetched first (client_id + start_at needed for subsequent calls)
  const visitDetail = await alayaFetch<VisitDetail>(`/scheduler/visits/${visitId}`);
  const clientId = visitDetail.client_id;

  // Employee roster from cache (employees + skills, bulk-fetched)
  // Visit-specific data (schedules, client history, offers) always fetched fresh
  const noClient = clientId == null;
  const emptyPaginated = { items: [], count: 0, page: 1, total_pages: 0 };

  const [roster, clientDetail, schedulesResult, clientHistoryResult, offersResult] =
    await Promise.all([
      getEmployeeRoster(),
      noClient
        ? Promise.resolve({ id: 0, latitude: null, longitude: null } as ClientDetail)
        : alayaFetch<ClientDetail>(`/patients/clients/${clientId}`),
      alayaFetch<AlayaPaginatedResponse<ScheduleVisit>>(
        `/scheduler/visits`,
        { searchParams: { date: visitDetail.start_at.split("T")[0] } }
      ),
      noClient
        ? Promise.resolve(emptyPaginated as AlayaPaginatedResponse<VisitHistoryItem>)
        : alayaFetch<AlayaPaginatedResponse<VisitHistoryItem>>(
            `/scheduler/visits`,
            { searchParams: { client_id: String(clientId) } }
          ),
      noClient
        ? Promise.resolve(emptyPaginated as AlayaPaginatedResponse<OfferItem>)
        : alayaFetch<AlayaPaginatedResponse<OfferItem>>(`/scheduler/visit_offers`, {
            searchParams: { client_id: String(clientId) },
          }),
    ]);

  const allEmployees = roster.employees;
  const skillsByEmployeeId = roster.skillsByEmployeeId;

  // Build lookup maps for bulk-fetched data
  const schedulesByEmployeeId = new Map<number, ScheduleVisit[]>();
  for (const sv of schedulesResult.items) {
    const existing = schedulesByEmployeeId.get(sv.employee_id) ?? [];
    existing.push(sv);
    schedulesByEmployeeId.set(sv.employee_id, existing);
  }

  const visitsByEmployeeId = new Map<number, VisitHistoryItem[]>();
  for (const vh of clientHistoryResult.items) {
    const existing = visitsByEmployeeId.get(vh.employee_id) ?? [];
    existing.push(vh);
    visitsByEmployeeId.set(vh.employee_id, existing);
  }

  const offersByEmployeeId = new Map<number, OfferItem[]>();
  for (const offer of offersResult.items) {
    const existing = offersByEmployeeId.get(offer.employee_id) ?? [];
    existing.push(offer);
    offersByEmployeeId.set(offer.employee_id, existing);
  }

  const requiredSkillIds = visitDetail.required_skill_ids ?? [];
  const candidatePoolSize = allEmployees.length;

  // ── Phase 2a: Pre-filter (no API calls — all data cached or bulk-fetched) ──
  // Filter by status (active only) and schedule conflicts
  const scheduleEligible: EmployeeDetail[] = [];
  for (const emp of allEmployees) {
    if (emp.status !== "active") continue;
    const empSchedule = schedulesByEmployeeId.get(emp.id) ?? [];
    const result = checkScheduleConflicts(empSchedule, {
      start_at: visitDetail.start_at,
      end_at: visitDetail.end_at,
    });
    if (result.eligible) {
      scheduleEligible.push(emp);
    }
  }

  // ── Phase 2b: Skills already bulk-fetched via cache — no per-employee calls ──

  // ── Phase 2c: Filter by skill qualifications ──
  const eligible: EmployeeDetail[] = [];
  for (const emp of scheduleEligible) {
    const empSkills = skillsByEmployeeId.get(emp.id) ?? [];
    const result = checkSkillQualifications(empSkills, requiredSkillIds, now);
    if (result.eligible) {
      eligible.push(emp);
    }
  }

  const eligiblePoolSize = eligible.length;

  // ── Data quality warnings (collected before early return so both paths get them) ──
  const dataWarnings: string[] = [];
  if (visitDetail.client_id == null) {
    dataWarnings.push("Visit has no client assigned");
  }
  const activeCount = allEmployees.filter((e) => e.status === "active").length;
  const inactiveCount = allEmployees.length - activeCount;
  if (inactiveCount > 0) {
    dataWarnings.push(`${inactiveCount} employees filtered (inactive/on_leave)`);
  }
  const scheduleFilteredCount = activeCount - scheduleEligible.length;
  if (scheduleFilteredCount > 0) {
    dataWarnings.push(`${scheduleFilteredCount} employees filtered by schedule conflicts`);
  }
  const missingCoords = scheduleEligible.filter(
    (e) => e.latitude == null || e.longitude == null
  ).length;
  if (missingCoords > 0) {
    dataWarnings.push(`${missingCoords} employees missing coordinates`);
  }
  const noSkillsCount = scheduleEligible.filter(
    (e) => (skillsByEmployeeId.get(e.id) ?? []).length === 0
  ).length;
  if (noSkillsCount > 0) {
    dataWarnings.push(`${noSkillsCount} employees have no skills on file`);
  }
  if (clientDetail.latitude == null || clientDetail.longitude == null) {
    dataWarnings.push("Client missing coordinates — proximity unavailable");
  }
  if (requiredSkillIds.length === 0) {
    dataWarnings.push("Visit has no required skills defined");
  }

  if (eligible.length === 0) {
    dataWarnings.push("No eligible employees after hard constraint filtering");
    return {
      visit_id: visitId,
      client_id: clientId,
      candidates: [],
      weights_used: weights,
      preset_name: presetName,
      candidate_pool_size: candidatePoolSize,
      eligible_pool_size: 0,
      data_warnings: dataWarnings,
      match_confidence: "low",
      scored_at: now.toISOString(),
      fetchedVisit: visitDetail,
      fetchedClient: noClient ? undefined : clientDetail,
    };
  }

  // ── Phase 3: Multi-Factor Scoring (WSM) ──
  // Pool statistics for workload scoring
  const shiftCounts = eligible.map(
    (emp) => (schedulesByEmployeeId.get(emp.id) ?? []).length
  );
  const poolMean = shiftCounts.reduce((a, b) => a + b, 0) / shiftCounts.length;
  const poolStddev =
    shiftCounts.length > 1
      ? Math.sqrt(
          shiftCounts.reduce((sum, c) => sum + (c - poolMean) ** 2, 0) /
            shiftCounts.length
        )
      : 0;

  const scored: ScoredCandidate[] = eligible.map((emp) => {
    const empSkills = skillsByEmployeeId.get(emp.id) ?? [];
    const empHistory = visitsByEmployeeId.get(emp.id) ?? [];
    const empOffers = offersByEmployeeId.get(emp.id) ?? [];
    const empShiftCount = (schedulesByEmployeeId.get(emp.id) ?? []).length;
    const warnings: string[] = [];

    // Run 5 dimension scorers
    const skills = scoreSkills(empSkills, requiredSkillIds, now);
    const relationship = scoreRelationship(empHistory, now);
    const proximity = scoreProximity(
      emp.latitude,
      emp.longitude,
      clientDetail.latitude,
      clientDetail.longitude
    );
    const workload = scoreWorkload(empShiftCount, poolMean, poolStddev);
    const acceptance = scoreAcceptance(empOffers);

    // Collect warnings
    if (emp.latitude == null || emp.longitude == null) {
      warnings.push("Employee missing coordinates");
    }
    if (empSkills.length === 0) {
      warnings.push("No skills on file");
    }

    const dimensions: DimensionBreakdown = {
      skills,
      relationship,
      proximity,
      workload,
      acceptance,
    };

    // Weighted sum
    const overall =
      skills.score * weights.skills +
      relationship.score * weights.relationship +
      proximity.score * weights.proximity +
      workload.score * weights.workload +
      acceptance.score * weights.acceptance;

    // Per-candidate confidence: lowest dimension confidence
    const confidenceLevels: DimensionScore["confidence"][] = [
      skills.confidence,
      relationship.confidence,
      proximity.confidence,
      workload.confidence,
      acceptance.confidence,
    ];
    const confidence: DimensionScore["confidence"] = confidenceLevels.includes("low")
      ? "low"
      : confidenceLevels.includes("medium")
        ? "medium"
        : "high";

    return {
      employee_id: emp.id,
      employee_name: `${emp.demographics.first_name} ${emp.demographics.last_name}`,
      overall,
      confidence,
      dimensions,
      warnings,
    };
  });

  // ── Phase 4: Ranking + Confidence ──
  scored.sort((a, b) => b.overall - a.overall);

  const limit = config.limit ?? scored.length;
  const candidates = scored.slice(0, limit);

  const matchConfidence = computeMatchConfidence(candidates);

  return {
    visit_id: visitId,
    client_id: clientId,
    candidates,
    weights_used: weights,
    preset_name: presetName,
    candidate_pool_size: candidatePoolSize,
    eligible_pool_size: eligiblePoolSize,
    data_warnings: dataWarnings,
    match_confidence: matchConfidence,
    scored_at: now.toISOString(),
    fetchedVisit: visitDetail,
    fetchedClient: noClient ? undefined : clientDetail,
  };
}
