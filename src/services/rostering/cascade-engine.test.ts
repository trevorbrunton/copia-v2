import { describe, it, expect } from "vitest";
import {
  isContactExpired,
  checkAndExpireContacts,
  advanceSequentialCascade,
  advanceParallelCascade,
  shouldEscalate,
} from "./cascade-engine";
import type { ContactAttempt, UrgencyConfig } from "./types";
import type { RosterTask } from "@/src/db/schema";

function makeContact(overrides: Partial<ContactAttempt> = {}): ContactAttempt {
  return {
    employee_id: 1,
    employee_name: "Alice Smith",
    contact_address: "+61400123456",
    rank: 0,
    overall_score: 0.85,
    channel: "sms",
    sent_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 20 * 60 * 1000).toISOString(), // 20 min from now
    response: "pending",
    responded_at: null,
    decline_reason: null,
    selection_reason: "Top candidate",
    ...overrides,
  };
}

function makeTask(overrides: Partial<RosterTask> = {}): RosterTask {
  return {
    id: "task-1",
    userId: "user-1",
    visitId: 100,
    clientId: 10,
    status: "contacting",
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
    firstContactAt: new Date(),
    resolvedAt: null,
    timeToFillMs: null,
    createdBy: "system",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as RosterTask;
}

// ─── isContactExpired ─────────────────────────────────────

describe("isContactExpired", () => {
  it("should return false for pending contact before expiry", () => {
    const contact = makeContact();
    expect(isContactExpired(contact)).toBe(false);
  });

  it("should return true for pending contact past expiry", () => {
    const contact = makeContact({
      expires_at: new Date(Date.now() - 1000).toISOString(),
    });
    expect(isContactExpired(contact)).toBe(true);
  });

  it("should return false for already-responded contact past expiry", () => {
    const contact = makeContact({
      response: "accepted",
      expires_at: new Date(Date.now() - 1000).toISOString(),
    });
    expect(isContactExpired(contact)).toBe(false);
  });
});

// ─── checkAndExpireContacts ───────────────────────────────

describe("checkAndExpireContacts", () => {
  it("should mark expired contact and signal cascade", () => {
    const task = makeTask({
      contacts: [makeContact({ expires_at: new Date(Date.now() - 1000).toISOString() })] as unknown as RosterTask["contacts"],
      currentContactIndex: 0,
    });

    const result = checkAndExpireContacts(task);
    expect(result.shouldCascade).toBe(true);
    expect(result.contacts[0].response).toBe("expired");
  });

  it("should not cascade when contact is still pending and valid", () => {
    const task = makeTask({
      contacts: [makeContact()] as unknown as RosterTask["contacts"],
      currentContactIndex: 0,
    });

    const result = checkAndExpireContacts(task);
    expect(result.shouldCascade).toBe(false);
  });

  it("should not cascade when no contacts exist", () => {
    const task = makeTask({
      contacts: [] as unknown as RosterTask["contacts"],
      currentContactIndex: 0,
    });

    const result = checkAndExpireContacts(task);
    expect(result.shouldCascade).toBe(false);
  });
});

// ─── advanceSequentialCascade ─────────────────────────────

describe("advanceSequentialCascade", () => {
  it("should advance to next candidate when current expires", () => {
    const contacts = [
      makeContact({ rank: 0, employee_id: 1, response: "expired", responded_at: new Date().toISOString() }),
      makeContact({ rank: 1, employee_id: 2, employee_name: "Bob Jones", contact_address: "+61400222222" }),
    ];
    const task = makeTask({
      contacts: contacts as unknown as RosterTask["contacts"],
      currentContactIndex: 0,
    });

    const result = advanceSequentialCascade(task);
    expect(result.nextContactIndex).toBe(1);
    expect(result.shouldEscalate).toBe(false);
  });

  it("should advance to next candidate when current declines", () => {
    const contacts = [
      makeContact({ rank: 0, employee_id: 1, response: "declined", responded_at: new Date().toISOString() }),
      makeContact({ rank: 1, employee_id: 2 }),
    ];
    const task = makeTask({
      contacts: contacts as unknown as RosterTask["contacts"],
      currentContactIndex: 0,
    });

    const result = advanceSequentialCascade(task);
    expect(result.nextContactIndex).toBe(1);
    expect(result.shouldEscalate).toBe(false);
  });

  it("should escalate when all contacts exhausted", () => {
    const contacts = [
      makeContact({ rank: 0, employee_id: 1, response: "declined" }),
      makeContact({ rank: 1, employee_id: 2, response: "expired" }),
      makeContact({ rank: 2, employee_id: 3, response: "declined" }),
    ];
    const task = makeTask({
      contacts: contacts as unknown as RosterTask["contacts"],
      currentContactIndex: 2,
    });

    const result = advanceSequentialCascade(task);
    expect(result.shouldEscalate).toBe(true);
    expect(result.nextContactIndex).toBe(2); // stays on last
  });

  it("should stop cascading when a contact is already accepted", () => {
    const contacts = [
      makeContact({ rank: 0, response: "declined" }),
      makeContact({ rank: 1, response: "accepted" }),
      makeContact({ rank: 2, employee_id: 3, contact_address: "+61400333333" }),
    ];
    const task = makeTask({
      contacts: contacts as unknown as RosterTask["contacts"],
      currentContactIndex: 0,
    });

    const result = advanceSequentialCascade(task);
    // Should recognize task is already filled — don't continue cascading
    expect(result.nextContactIndex).toBe(0);
    expect(result.shouldEscalate).toBe(false);
  });
});

// ─── advanceParallelCascade ───────────────────────────────

describe("advanceParallelCascade", () => {
  it("should identify first accepted contact from parallel batch", () => {
    const contacts = [
      makeContact({ rank: 0, employee_id: 1, response: "pending" }),
      makeContact({ rank: 1, employee_id: 2, response: "accepted", responded_at: new Date().toISOString() }),
      makeContact({ rank: 2, employee_id: 3, response: "pending" }),
    ];
    const task = makeTask({
      contacts: contacts as unknown as RosterTask["contacts"],
      cascadeStrategy: "parallel",
    });

    const result = advanceParallelCascade(task);
    expect(result.acceptedIndex).toBe(1);
    expect(result.shouldEscalate).toBe(false);
    expect(result.cancelledIndices).toEqual([0, 2]);
  });

  it("should escalate when all parallel contacts declined or expired", () => {
    const contacts = [
      makeContact({ rank: 0, response: "declined" }),
      makeContact({ rank: 1, response: "expired" }),
      makeContact({ rank: 2, response: "declined" }),
    ];
    const task = makeTask({
      contacts: contacts as unknown as RosterTask["contacts"],
      cascadeStrategy: "parallel",
    });

    const result = advanceParallelCascade(task);
    expect(result.acceptedIndex).toBeNull();
    expect(result.shouldEscalate).toBe(true);
  });

  it("should not escalate when some contacts still pending", () => {
    const contacts = [
      makeContact({ rank: 0, response: "declined" }),
      makeContact({ rank: 1, response: "pending" }),
      makeContact({ rank: 2, response: "declined" }),
    ];
    const task = makeTask({
      contacts: contacts as unknown as RosterTask["contacts"],
      cascadeStrategy: "parallel",
    });

    const result = advanceParallelCascade(task);
    expect(result.acceptedIndex).toBeNull();
    expect(result.shouldEscalate).toBe(false);
    expect(result.cancelledIndices).toEqual([]);
  });
});

// ─── shouldEscalate ───────────────────────────────────────

describe("shouldEscalate", () => {
  it("should escalate sequential when contacts exhausted past threshold", () => {
    const config: UrgencyConfig = {
      weightPreset: "planned",
      cascadeStrategy: "sequential",
      expiryMinutes: 120,
      escalationThreshold: { type: "contacts", count: 3 },
    };
    const contacts = [
      makeContact({ rank: 0, response: "declined" }),
      makeContact({ rank: 1, response: "expired" }),
      makeContact({ rank: 2, response: "declined" }),
    ];
    const task = makeTask({
      contacts: contacts as unknown as RosterTask["contacts"],
      currentContactIndex: 2,
    });

    expect(shouldEscalate(task, config)).toBe(true);
  });

  it("should not escalate when below contact threshold", () => {
    const config: UrgencyConfig = {
      weightPreset: "planned",
      cascadeStrategy: "sequential",
      expiryMinutes: 120,
      escalationThreshold: { type: "contacts", count: 5 },
    };
    const contacts = [
      makeContact({ rank: 0, response: "declined" }),
      makeContact({ rank: 1, response: "expired" }),
    ];
    const task = makeTask({
      contacts: contacts as unknown as RosterTask["contacts"],
      currentContactIndex: 1,
    });

    expect(shouldEscalate(task, config)).toBe(false);
  });

  it("should escalate parallel when time threshold exceeded", () => {
    const config: UrgencyConfig = {
      weightPreset: "urgent",
      cascadeStrategy: "parallel",
      expiryMinutes: 15,
      escalationThreshold: { type: "time", minutes: 15 },
    };
    const task = makeTask({
      cascadeStrategy: "parallel",
      firstContactAt: new Date(Date.now() - 20 * 60 * 1000), // 20 min ago
    });

    expect(shouldEscalate(task, config)).toBe(true);
  });

  it("should not escalate parallel when within time threshold", () => {
    const config: UrgencyConfig = {
      weightPreset: "urgent",
      cascadeStrategy: "parallel",
      expiryMinutes: 15,
      escalationThreshold: { type: "time", minutes: 15 },
    };
    const task = makeTask({
      cascadeStrategy: "parallel",
      firstContactAt: new Date(Date.now() - 5 * 60 * 1000), // 5 min ago
    });

    expect(shouldEscalate(task, config)).toBe(false);
  });
});
