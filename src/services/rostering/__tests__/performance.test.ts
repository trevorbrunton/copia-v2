import { describe, it, expect } from "vitest";
import { scoreSkills } from "@/src/services/scoring/score-skills";
import { scoreRelationship } from "@/src/services/scoring/score-relationship";
import { scoreProximity } from "@/src/services/scoring/score-proximity";
import { scoreWorkload } from "@/src/services/scoring/score-workload";
import { scoreAcceptance } from "@/src/services/scoring/score-acceptance";
import { computeMatchConfidence } from "@/src/services/scoring/match-confidence";
import { checkAndExpireContacts, advanceSequentialCascade, shouldEscalate } from "../cascade-engine";
import { extractOutcome } from "../outcome-tracker";
import type { RosterTask } from "@/src/db/schema";
import type { UrgencyConfig } from "../types";
import type { ScoredCandidate } from "@/src/services/scoring/types";

/**
 * Performance benchmark tests — validate that critical operations
 * complete within acceptable time budgets.
 */

function makeCandidate(index: number) {
  return {
    skills: [{ skill_id: index, expired_date: null }],
    priorVisits: Array.from({ length: Math.floor(Math.random() * 5) }, () => ({ start_at: "2026-01-01T09:00:00Z" })),
    offers: Array.from({ length: Math.floor(Math.random() * 10) }, () => ({
      status: Math.random() > 0.5 ? "accepted" : "declined",
    })),
    lat: -33.8 + Math.random() * 0.5,
    lng: 151.2 + Math.random() * 0.5,
    shiftCount: Math.floor(Math.random() * 10),
  };
}

function makeScoredCandidate(index: number): ScoredCandidate {
  return {
    employee_id: index,
    employee_name: `Worker${index}`,
    overall: 0.9 - index * 0.02,
    confidence: index < 3 ? "high" : "medium",
    dimensions: {
      skills: { score: 0.8, confidence: "high", reason: "" },
      relationship: { score: 0.6, confidence: "medium", reason: "" },
      proximity: { score: 0.7, confidence: "high", reason: "" },
      workload: { score: 0.5, confidence: "low", reason: "" },
      acceptance: { score: 0.9, confidence: "high", reason: "" },
    },
    warnings: [],
  };
}

function makeTask(contactCount: number): RosterTask {
  const contacts = Array.from({ length: contactCount }, (_, i) => ({
    employee_id: 100 + i,
    employee_name: `Worker${i}`,
    contact_address: `+614000000${i}`,
    rank: i,
    overall_score: 0.9 - i * 0.01,
    channel: "sms",
    sent_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 120 * 60000).toISOString(),
    response: i < contactCount - 1 ? "declined" : "pending",
    responded_at: i < contactCount - 1 ? new Date().toISOString() : null,
    decline_reason: i < contactCount - 1 ? "unavailable" : null,
    selection_reason: `Rank ${i}`,
  }));

  return {
    id: "perf-task-1",
    userId: "user-1",
    visitId: 100,
    clientId: 200,
    status: "cascading",
    urgency: "planned",
    version: 1,
    matchResult: null,
    llmRecommendation: null,
    contacts: contacts as unknown,
    currentContactIndex: contactCount - 1,
    cascadeStrategy: "sequential",
    assignedEmployeeId: null,
    escalatedTo: null,
    escalationReason: null,
    sourceEventId: null,
    detectedAt: new Date(),
    scoringCompletedAt: null,
    firstContactAt: null,
    resolvedAt: null,
    timeToFillMs: null,
    createdBy: "system",
    createdAt: new Date(),
    updatedAt: new Date(),
  } as RosterTask;
}

describe("Performance Benchmarks", () => {
  it("should score 150 candidates in <100ms", () => {
    const candidates = Array.from({ length: 150 }, (_, i) => makeCandidate(i));
    const requiredSkills = [1, 2, 3];
    const now = new Date();
    const clientLat = -33.87;
    const clientLng = 151.21;

    const start = performance.now();

    for (const c of candidates) {
      scoreSkills(c.skills, requiredSkills, now);
      scoreRelationship(c.priorVisits, now);
      scoreProximity(c.lat, c.lng, clientLat, clientLng);
      scoreWorkload(c.shiftCount, 5, 2);
      scoreAcceptance(c.offers);
    }

    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(100); // <100ms for 150 candidates
  });

  it("should compute match confidence for 150 candidate sets in <10ms", () => {
    const candidateSets = Array.from({ length: 150 }, () =>
      Array.from({ length: 5 }, (_, i) => makeScoredCandidate(i))
    );

    const start = performance.now();

    for (const candidates of candidateSets) {
      computeMatchConfidence(candidates);
    }

    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(10);
  });

  it("should handle cascade with 50 contacts in <5ms", () => {
    const task = makeTask(50);

    const start = performance.now();

    checkAndExpireContacts(task);
    advanceSequentialCascade(task);

    const config: UrgencyConfig = {
      weightPreset: "planned",
      cascadeStrategy: "sequential",
      expiryMinutes: 120,
      escalationThreshold: { type: "contacts", count: 100 },
    };
    shouldEscalate(task, config);

    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(5);
  });

  it("should extract outcomes from 1000 tasks in <10ms", () => {
    const tasks = Array.from({ length: 1000 }, (_, i) => ({
      ...makeTask(5),
      id: `task-${i}`,
      status: i % 3 === 0 ? "escalated" : "assigned",
      assignedEmployeeId: i % 3 !== 0 ? 100 : null,
      escalatedTo: i % 3 === 0 ? "coord-1" : null,
      timeToFillMs: 300000 + i * 1000,
    }));

    const start = performance.now();

    for (const task of tasks) {
      extractOutcome(task as RosterTask);
    }

    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(10);
  });

  it("should handle concurrent task state evaluations in <20ms", () => {
    // Simulate 10 concurrent tasks being evaluated
    const tasks = Array.from({ length: 10 }, (_, i) =>
      makeTask(Math.floor(Math.random() * 20) + 1)
    );

    const start = performance.now();

    for (const task of tasks) {
      checkAndExpireContacts(task);
      advanceSequentialCascade(task);
      shouldEscalate(task, {
        weightPreset: "planned",
        cascadeStrategy: "sequential",
        expiryMinutes: 120,
        escalationThreshold: { type: "contacts", count: 50 },
      });
      extractOutcome(task as RosterTask);
    }

    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(20);
  });
});
