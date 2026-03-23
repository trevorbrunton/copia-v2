import type { ContactAttempt, UrgencyConfig } from "./types";
import type { RosterTask } from "@/src/db/schema";

/** Check if a contact attempt has expired based on current time. */
export function isContactExpired(contact: ContactAttempt): boolean {
  if (contact.response !== "pending") return false;
  return new Date(contact.expires_at).getTime() < Date.now();
}

/**
 * Check current contact for expiry, mark it expired, and signal cascade.
 * Returns updated contacts array and whether the task should cascade.
 */
export function checkAndExpireContacts(task: RosterTask): {
  contacts: ContactAttempt[];
  shouldCascade: boolean;
} {
  const contacts = (task.contacts ?? []) as ContactAttempt[];
  const currentIndex = task.currentContactIndex ?? 0;
  const current = contacts[currentIndex];

  if (!current || current.response !== "pending") {
    return { contacts, shouldCascade: false };
  }

  if (!isContactExpired(current)) {
    return { contacts, shouldCascade: false };
  }

  // Mark as expired
  const updated = [...contacts];
  updated[currentIndex] = {
    ...current,
    response: "expired",
    responded_at: new Date().toISOString(),
  };

  return { contacts: updated, shouldCascade: true };
}

// ─── Sequential Cascade ───────────────────────────────────

export interface SequentialCascadeResult {
  nextContactIndex: number;
  shouldEscalate: boolean;
}

/**
 * Sequential cascade: find the next contactable candidate after the current one.
 * Skips candidates that are already accepted, declined, or expired.
 * Returns nextContactIndex and whether escalation is needed (all exhausted).
 */
export function advanceSequentialCascade(task: RosterTask): SequentialCascadeResult {
  const contacts = (task.contacts ?? []) as ContactAttempt[];
  const currentIndex = task.currentContactIndex ?? 0;

  // If any contact is already accepted, task should not cascade further
  // (invariant: all contacts initialized with response: "pending")
  if (contacts.some((c) => c.response === "accepted")) {
    return { nextContactIndex: currentIndex, shouldEscalate: false };
  }

  // Look for the next pending contact after current
  for (let i = currentIndex + 1; i < contacts.length; i++) {
    if (contacts[i].response === "pending") {
      return { nextContactIndex: i, shouldEscalate: false };
    }
  }

  // All contacts exhausted — escalate
  return { nextContactIndex: currentIndex, shouldEscalate: true };
}

// ─── Parallel Cascade ─────────────────────────────────────

export interface ParallelCascadeResult {
  /** Index of first accepted contact, or null if none accepted. */
  acceptedIndex: number | null;
  /** Indices of pending contacts to cancel (after an accept). */
  cancelledIndices: number[];
  /** Whether all contacts are resolved with no accept. */
  shouldEscalate: boolean;
}

/**
 * Parallel cascade: all candidates contacted simultaneously.
 * First accept wins — other pending contacts should be cancelled.
 * Escalate only when ALL contacts are resolved (no pending) and none accepted.
 */
export function advanceParallelCascade(task: RosterTask): ParallelCascadeResult {
  const contacts = (task.contacts ?? []) as ContactAttempt[];

  // Check for an accepted contact
  const acceptedIdx = contacts.findIndex((c) => c.response === "accepted");
  if (acceptedIdx !== -1) {
    // Cancel all other pending contacts
    const cancelledIndices = contacts
      .map((c, i) => (i !== acceptedIdx && c.response === "pending" ? i : -1))
      .filter((i) => i !== -1);
    return { acceptedIndex: acceptedIdx, cancelledIndices, shouldEscalate: false };
  }

  // No accept — check if any still pending
  const hasPending = contacts.some((c) => c.response === "pending");
  if (hasPending) {
    return { acceptedIndex: null, cancelledIndices: [], shouldEscalate: false };
  }

  // All resolved, none accepted → escalate
  return { acceptedIndex: null, cancelledIndices: [], shouldEscalate: true };
}

// ─── Escalation Trigger ───────────────────────────────────

/**
 * Check if a task should be escalated based on its urgency config thresholds.
 *
 * - Contact-based (sequential): escalate after N contacts exhausted (declined/expired)
 * - Time-based (parallel): escalate after N minutes since first contact
 */
export function shouldEscalate(task: RosterTask, config: UrgencyConfig): boolean {
  const contacts = (task.contacts ?? []) as ContactAttempt[];

  if (config.escalationThreshold.type === "contacts") {
    const exhausted = contacts.filter(
      (c) => c.response === "declined" || c.response === "expired"
    ).length;
    return exhausted >= config.escalationThreshold.count;
  }

  if (config.escalationThreshold.type === "time") {
    if (!task.firstContactAt) return false;
    const elapsed = Date.now() - new Date(task.firstContactAt).getTime();
    return elapsed >= config.escalationThreshold.minutes * 60 * 1000;
  }

  return false;
}
