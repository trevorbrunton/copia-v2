/**
 * Sprint 4 Task 4.2: Comparison tooling.
 *
 * Runs all 32 scoring scenarios and produces a formatted comparison report
 * as a JSON artefact at `docs/comparison-report.json`. Also validates each
 * scenario against its expected outcome from SCENARIO_EXPECTATIONS.
 *
 * Run with: bun run test -- src/services/scoring/comparison-report.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";

vi.mock("@/src/lib/alayacare-client", () => ({
  alayaFetch: vi.fn(),
}));

import { alayaFetch } from "@/src/lib/alayacare-client";
import { computeMatch } from "./compute-match";
import { SCENARIO_EXPECTATIONS, type ScenarioExpectation } from "./scenario-expectations";
import { SCENARIOS } from "./scenario-test-helpers";
import { alayaCareCache } from "@/src/lib/alayacare-cache";

const mockedAlayaFetch = vi.mocked(alayaFetch);

// ── Report generation ──

interface ScenarioReportEntry {
  id: string;
  category: string;
  name: string;
  preset: string | null;
  topEmployee: { id: number; name: string; score: number } | null;
  matchConfidence: string;
  eligiblePool: number;
  candidatePool: number;
  rankings: { rank: number; employeeId: number; name: string; overall: number; confidence: string }[];
  dimensionBreakdown: Record<number, Record<string, { score: number; confidence: string }>>;
  dataWarnings: string[];
  expectation: ScenarioExpectation | null;
  expectationMet: boolean;
}

const reportEntries: ScenarioReportEntry[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  alayaCareCache.clear();
});

describe("Comparison Report: Run all 32 scenarios", () => {
  for (const scenario of SCENARIOS) {
    it(`${scenario.id}: produces valid MatchResult`, async () => {
      scenario.setup(mockedAlayaFetch);

      const config: Record<string, unknown> = {};
      if (scenario.preset) config.preset = scenario.preset;
      if (scenario.weights) config.weights = scenario.weights;
      if (scenario.limit) config.limit = scenario.limit;

      const result = await computeMatch(100, config);

      // Validate structure
      expect(result.visit_id).toBe(100);
      expect(result.scored_at).toBeDefined();
      expect(result.weights_used).toBeDefined();

      // Build report entry
      const expectation = SCENARIO_EXPECTATIONS.find((e) => e.id === scenario.id) ?? null;
      const top = result.candidates[0] ?? null;

      let expectationMet = true;
      if (expectation) {
        if (expectation.expectedTopEmployee !== undefined && top) {
          expectationMet = expectationMet && top.employee_id === expectation.expectedTopEmployee;
        }
        if (expectation.expectedConfidence) {
          expectationMet = expectationMet && result.match_confidence === expectation.expectedConfidence;
        }
        if (expectation.expectedEligible !== undefined) {
          expectationMet = expectationMet && result.eligible_pool_size === expectation.expectedEligible;
        }
        if (expectation.minTopScore !== undefined && top) {
          expectationMet = expectationMet && top.overall >= expectation.minTopScore;
        }
      }

      const entry: ScenarioReportEntry = {
        id: scenario.id,
        category: expectation?.category ?? "Unknown",
        name: expectation?.name ?? scenario.id,
        preset: result.preset_name,
        topEmployee: top ? { id: top.employee_id, name: top.employee_name, score: top.overall } : null,
        matchConfidence: result.match_confidence,
        eligiblePool: result.eligible_pool_size,
        candidatePool: result.candidate_pool_size,
        rankings: result.candidates.map((c, i) => ({
          rank: i + 1,
          employeeId: c.employee_id,
          name: c.employee_name,
          overall: Math.round(c.overall * 1000) / 1000,
          confidence: c.confidence,
        })),
        dimensionBreakdown: Object.fromEntries(
          result.candidates.map((c) => [
            c.employee_id,
            Object.fromEntries(
              Object.entries(c.dimensions).map(([dim, ds]) => [
                dim,
                { score: Math.round(ds.score * 1000) / 1000, confidence: ds.confidence },
              ])
            ),
          ])
        ),
        dataWarnings: result.data_warnings,
        expectation,
        expectationMet,
      };

      reportEntries.push(entry);

      // Assert expectations match
      if (expectation?.expectedTopEmployee !== undefined && top) {
        expect(top.employee_id).toBe(expectation.expectedTopEmployee);
      }
      if (expectation?.expectedConfidence) {
        expect(result.match_confidence).toBe(expectation.expectedConfidence);
      }
      if (expectation?.expectedEligible !== undefined) {
        expect(result.eligible_pool_size).toBe(expectation.expectedEligible);
      }
    });
  }
});

afterAll(() => {
  // Write comparison report JSON
  const reportPath = path.join(process.cwd(), "docs", "comparison-report.json");
  const summary = {
    generatedAt: new Date().toISOString(),
    totalScenarios: reportEntries.length,
    categoryCounts: reportEntries.reduce((acc, e) => {
      acc[e.category] = (acc[e.category] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>),
    expectationsMet: reportEntries.filter((e) => e.expectationMet).length,
    expectationsFailed: reportEntries.filter((e) => !e.expectationMet).length,
    presetDistribution: reportEntries.reduce((acc, e) => {
      const key = e.preset ?? "default";
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>),
    scenarios: reportEntries,
  };

  fs.writeFileSync(reportPath, JSON.stringify(summary, null, 2));
});
