import type { RosterTask } from "@/src/db/schema";
import type { ContactAttempt, Urgency } from "./types";

/**
 * Outcome of a completed/escalated roster task — used by learning systems.
 */
export interface TaskOutcome {
  task_id: string;
  total_contacts: number;
  accepted_at_rank: number | null; // Which rank accepted (0 = first contact), null if escalated
  time_to_fill_ms: number | null;
  human_intervention: boolean;
  cascade_rounds: number;
  urgency: Urgency;
  status: string;
}

/**
 * Extract a structured outcome from a resolved roster task.
 * Works for assigned, completed, escalated, and cancelled tasks.
 */
export function extractOutcome(task: RosterTask): TaskOutcome {
  const contacts = (task.contacts ?? []) as ContactAttempt[];
  const acceptedContact = contacts.find((c) => c.response === "accepted");

  return {
    task_id: task.id,
    total_contacts: contacts.length,
    accepted_at_rank: acceptedContact?.rank ?? null,
    time_to_fill_ms: task.timeToFillMs,
    human_intervention: task.escalatedTo != null,
    cascade_rounds: contacts.filter((c) => c.response !== "pending").length,
    urgency: task.urgency as Urgency,
    status: task.status,
  };
}
