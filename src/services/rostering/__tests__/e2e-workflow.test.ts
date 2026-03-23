import { describe, it, expect, vi, beforeEach } from "vitest";
import { extractOutcome } from "../outcome-tracker";
import {
  checkAndExpireContacts,
  advanceSequentialCascade,
  advanceParallelCascade,
  shouldEscalate,
} from "../cascade-engine";
import type { RosterTask } from "@/src/db/schema";
import type { ContactAttempt, UrgencyConfig } from "../types";

/**
 * E2E workflow scenario tests — validate the full lifecycle of roster tasks
 * by testing the composition of individual services (scoring, cascade, outcome).
 *
 * These tests exercise the data flow: task creation → state transitions →
 * cascade logic → outcome extraction, using in-memory data.
 */

function makeTask(overrides: Partial<RosterTask> = {}): RosterTask {
  return {
    id: "task-1",
    userId: "user-1",
    visitId: 100,
    clientId: 200,
    status: "detected",
    urgency: "planned",
    version: 1,
    matchResult: null,
    llmRecommendation: null,
    contacts: [],
    currentContactIndex: 0,
    cascadeStrategy: "sequential",
    assignedEmployeeId: null,
    escalatedTo: null,
    escalationReason: null,
    sourceEventId: null,
    detectedAt: new Date("2026-03-11T08:00:00Z"),
    scoringCompletedAt: null,
    firstContactAt: null,
    resolvedAt: null,
    timeToFillMs: null,
    createdBy: "system",
    createdAt: new Date("2026-03-11T08:00:00Z"),
    updatedAt: new Date("2026-03-11T08:00:00Z"),
    ...overrides,
  } as RosterTask;
}

function makeContact(rank: number, response: string, overrides: Partial<ContactAttempt> = {}): ContactAttempt {
  const now = new Date();
  return {
    employee_id: 100 + rank,
    employee_name: `Worker${rank}`,
    contact_address: `+614000000${rank}`,
    rank,
    overall_score: 0.9 - rank * 0.1,
    channel: "sms",
    sent_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 120 * 60000).toISOString(), // 2h expiry
    response: response as ContactAttempt["response"],
    responded_at: response !== "pending" ? now.toISOString() : null,
    decline_reason: response === "declined" ? "unavailable" : null,
    selection_reason: `Rank ${rank}`,
    ...overrides,
  };
}

const PLANNED_CONFIG: UrgencyConfig = {
  weightPreset: "planned",
  cascadeStrategy: "sequential",
  expiryMinutes: 120,
  escalationThreshold: { type: "contacts", count: 10 },
};

const URGENT_CONFIG: UrgencyConfig = {
  weightPreset: "urgent",
  cascadeStrategy: "parallel",
  expiryMinutes: 15,
  escalationThreshold: { type: "time", minutes: 15 },
};

describe("E2E Workflow Scenarios", () => {
  describe("Scenario 1: Happy path — first contact accepts", () => {
    it("should complete the full lifecycle from detected to outcome", () => {
      // Step 1: Task detected with contacts ready
      const task = makeTask({
        status: "contacting",
        contacts: [makeContact(0, "pending")] as unknown,
        currentContactIndex: 0,
      });

      // Step 2: Contact hasn't expired yet
      const { shouldCascade } = checkAndExpireContacts(task);
      expect(shouldCascade).toBe(false);

      // Step 3: Contact accepts — task becomes assigned
      const assignedTask = makeTask({
        ...task,
        status: "assigned",
        assignedEmployeeId: 100,
        resolvedAt: new Date("2026-03-11T08:05:00Z"),
        timeToFillMs: 300000, // 5 min
        contacts: [makeContact(0, "accepted")] as unknown,
      });

      // Step 4: Extract outcome
      const outcome = extractOutcome(assignedTask);
      expect(outcome.accepted_at_rank).toBe(0);
      expect(outcome.total_contacts).toBe(1);
      expect(outcome.human_intervention).toBe(false);
      expect(outcome.time_to_fill_ms).toBe(300000);
    });
  });

  describe("Scenario 2: Sequential cascade — first declines, second accepts", () => {
    it("should cascade to second contact after first declines", () => {
      const task = makeTask({
        status: "cascading",
        cascadeStrategy: "sequential",
        contacts: [
          makeContact(0, "declined"),
          makeContact(1, "pending"),
        ] as unknown,
        currentContactIndex: 0,
      });

      const result = advanceSequentialCascade(task);
      expect(result.shouldEscalate).toBe(false);
      expect(result.nextContactIndex).toBe(1);

      // Second contact accepts
      const completedTask = makeTask({
        status: "assigned",
        assignedEmployeeId: 101,
        timeToFillMs: 600000,
        contacts: [
          makeContact(0, "declined"),
          makeContact(1, "accepted"),
        ] as unknown,
      });

      const outcome = extractOutcome(completedTask);
      expect(outcome.accepted_at_rank).toBe(1);
      expect(outcome.total_contacts).toBe(2);
      expect(outcome.cascade_rounds).toBe(2);
    });
  });

  describe("Scenario 3: Escalation flow — all contacts exhausted", () => {
    it("should escalate when all contacts decline", () => {
      const task = makeTask({
        status: "cascading",
        cascadeStrategy: "sequential",
        contacts: [
          makeContact(0, "declined"),
          makeContact(1, "declined"),
        ] as unknown,
        currentContactIndex: 1,
      });

      const result = advanceSequentialCascade(task);
      expect(result.shouldEscalate).toBe(true);

      // Escalated task outcome
      const escalatedTask = makeTask({
        status: "escalated",
        escalatedTo: "coordinator-1",
        escalationReason: "All contacts exhausted",
        contacts: task.contacts as unknown,
      });

      const outcome = extractOutcome(escalatedTask);
      expect(outcome.human_intervention).toBe(true);
      expect(outcome.accepted_at_rank).toBeNull();
    });
  });

  describe("Scenario 4: Parallel cascade — urgent shift, first accept wins", () => {
    it("should accept first responder and cancel others", () => {
      const task = makeTask({
        status: "cascading",
        urgency: "urgent",
        cascadeStrategy: "parallel",
        contacts: [
          makeContact(0, "pending"),
          makeContact(1, "accepted"),
          makeContact(2, "pending"),
        ] as unknown,
      });

      const result = advanceParallelCascade(task);
      expect(result.acceptedIndex).toBe(1);
      expect(result.cancelledIndices).toEqual([0, 2]);

      const assignedTask = makeTask({
        status: "assigned",
        urgency: "urgent",
        assignedEmployeeId: 101,
        timeToFillMs: 180000,
        contacts: task.contacts as unknown,
      });

      const outcome = extractOutcome(assignedTask);
      expect(outcome.accepted_at_rank).toBe(1);
      expect(outcome.urgency).toBe("urgent");
    });
  });

  describe("Scenario 5: Contact expiry triggers cascade", () => {
    it("should mark expired contacts and trigger cascade", () => {
      const pastTime = new Date(Date.now() - 3 * 3600000).toISOString(); // 3 hours ago
      const task = makeTask({
        status: "contacting",
        contacts: [
          makeContact(0, "pending", {
            sent_at: pastTime,
            expires_at: new Date(Date.now() - 3600000).toISOString(), // Expired 1h ago
          }),
          makeContact(1, "pending"),
        ] as unknown,
        currentContactIndex: 0,
      });

      const result = checkAndExpireContacts(task);
      expect(result.shouldCascade).toBe(true);
      expect(result.contacts[0].response).toBe("expired");
    });
  });

  describe("Scenario 6: Escalation threshold — contact count", () => {
    it("should escalate when contact count threshold reached", () => {
      const contacts = Array.from({ length: 10 }, (_, i) =>
        makeContact(i, "declined")
      );

      const task = makeTask({
        status: "cascading",
        contacts: contacts as unknown,
        currentContactIndex: 9,
      });

      expect(shouldEscalate(task, PLANNED_CONFIG)).toBe(true);
    });

    it("should not escalate below threshold", () => {
      const contacts = Array.from({ length: 5 }, (_, i) =>
        makeContact(i, "declined")
      );

      const task = makeTask({
        status: "cascading",
        contacts: contacts as unknown,
        currentContactIndex: 4,
      });

      expect(shouldEscalate(task, PLANNED_CONFIG)).toBe(false);
    });
  });

  describe("Scenario 7: Escalation threshold — time based (urgent)", () => {
    it("should escalate when time threshold exceeded", () => {
      const task = makeTask({
        status: "cascading",
        urgency: "urgent",
        detectedAt: new Date(Date.now() - 20 * 60000), // 20 min ago
        firstContactAt: new Date(Date.now() - 20 * 60000), // first contact 20 min ago
        contacts: [makeContact(0, "declined")] as unknown,
      });

      expect(shouldEscalate(task, URGENT_CONFIG)).toBe(true);
    });
  });

  describe("Scenario 8: Cancel flow — task cancelled during contacting", () => {
    it("should produce correct outcome for cancelled task", () => {
      const task = makeTask({
        status: "cancelled",
        contacts: [
          makeContact(0, "pending"),
        ] as unknown,
      });

      const outcome = extractOutcome(task);
      expect(outcome.status).toBe("cancelled");
      expect(outcome.accepted_at_rank).toBeNull();
      expect(outcome.total_contacts).toBe(1);
    });
  });

  describe("Scenario 9: No contacts — immediate escalation", () => {
    it("should escalate with empty contacts when no candidates available", () => {
      const task = makeTask({
        status: "escalated",
        escalatedTo: "coordinator-1",
        escalationReason: "No match result or eligible candidates",
        contacts: [],
      });

      const outcome = extractOutcome(task);
      expect(outcome.total_contacts).toBe(0);
      expect(outcome.human_intervention).toBe(true);
      expect(outcome.cascade_rounds).toBe(0);
    });
  });

  describe("Scenario 10: Parallel cascade — all decline", () => {
    it("should escalate when all parallel contacts decline", () => {
      const task = makeTask({
        status: "cascading",
        urgency: "urgent",
        cascadeStrategy: "parallel",
        contacts: [
          makeContact(0, "declined"),
          makeContact(1, "declined"),
          makeContact(2, "declined"),
        ] as unknown,
      });

      const result = advanceParallelCascade(task);
      expect(result.shouldEscalate).toBe(true);
      expect(result.acceptedIndex).toBeNull();
    });
  });
});
