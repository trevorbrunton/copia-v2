import { describe, it, expect } from "vitest";
import { extractOutcome } from "./outcome-tracker";
import type { RosterTask } from "@/src/db/schema";

function makeTask(overrides: Partial<RosterTask> = {}): RosterTask {
  return {
    id: "task-1",
    userId: "user-1",
    visitId: 100,
    clientId: 200,
    status: "completed",
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
    detectedAt: new Date(),
    scoringCompletedAt: null,
    firstContactAt: null,
    resolvedAt: null,
    timeToFillMs: null,
    createdBy: "system",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as RosterTask;
}

describe("extractOutcome", () => {
  it("should extract outcome from a task accepted on first contact", () => {
    const task = makeTask({
      status: "assigned",
      timeToFillMs: 120000,
      contacts: [
        { employee_id: 1, employee_name: "Alice", rank: 0, response: "accepted", contact_address: "+61400000001", overall_score: 0.9, channel: "sms", sent_at: "2026-01-01T00:00:00Z", expires_at: "2026-01-01T01:00:00Z", responded_at: "2026-01-01T00:05:00Z", decline_reason: null, selection_reason: "top ranked" },
      ] as unknown,
    });

    const outcome = extractOutcome(task);

    expect(outcome.task_id).toBe("task-1");
    expect(outcome.total_contacts).toBe(1);
    expect(outcome.accepted_at_rank).toBe(0);
    expect(outcome.time_to_fill_ms).toBe(120000);
    expect(outcome.human_intervention).toBe(false);
    expect(outcome.urgency).toBe("planned");
  });

  it("should extract outcome from an escalated task", () => {
    const task = makeTask({
      status: "escalated",
      escalatedTo: "coordinator-1",
      escalationReason: "No candidates accepted",
      timeToFillMs: null,
      contacts: [
        { employee_id: 1, employee_name: "Alice", rank: 0, response: "declined", contact_address: "+61400000001", overall_score: 0.8, channel: "sms", sent_at: "2026-01-01T00:00:00Z", expires_at: "2026-01-01T01:00:00Z", responded_at: "2026-01-01T00:10:00Z", decline_reason: "unavailable", selection_reason: "top ranked" },
        { employee_id: 2, employee_name: "Bob", rank: 1, response: "expired", contact_address: "+61400000002", overall_score: 0.7, channel: "sms", sent_at: "2026-01-01T00:10:00Z", expires_at: "2026-01-01T01:10:00Z", responded_at: null, decline_reason: null, selection_reason: "second ranked" },
      ] as unknown,
    });

    const outcome = extractOutcome(task);

    expect(outcome.total_contacts).toBe(2);
    expect(outcome.accepted_at_rank).toBeNull();
    expect(outcome.human_intervention).toBe(true);
    expect(outcome.cascade_rounds).toBe(2); // declined + expired
    expect(outcome.status).toBe("escalated");
  });

  it("should extract outcome from a task accepted on second contact", () => {
    const task = makeTask({
      status: "assigned",
      timeToFillMs: 600000,
      urgency: "urgent",
      contacts: [
        { employee_id: 1, employee_name: "Alice", rank: 0, response: "declined", contact_address: "+61400000001", overall_score: 0.9, channel: "sms", sent_at: "2026-01-01T00:00:00Z", expires_at: "2026-01-01T01:00:00Z", responded_at: "2026-01-01T00:05:00Z", decline_reason: "busy", selection_reason: "top ranked" },
        { employee_id: 2, employee_name: "Bob", rank: 1, response: "accepted", contact_address: "+61400000002", overall_score: 0.85, channel: "sms", sent_at: "2026-01-01T00:05:00Z", expires_at: "2026-01-01T01:05:00Z", responded_at: "2026-01-01T00:10:00Z", decline_reason: null, selection_reason: "second ranked" },
      ] as unknown,
    });

    const outcome = extractOutcome(task);

    expect(outcome.accepted_at_rank).toBe(1);
    expect(outcome.total_contacts).toBe(2);
    expect(outcome.urgency).toBe("urgent");
  });

  it("should handle cancelled task with no contacts", () => {
    const task = makeTask({ status: "cancelled", contacts: [] });
    const outcome = extractOutcome(task);

    expect(outcome.total_contacts).toBe(0);
    expect(outcome.accepted_at_rank).toBeNull();
    expect(outcome.human_intervention).toBe(false);
    expect(outcome.cascade_rounds).toBe(0);
  });
});
