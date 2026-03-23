import { z } from "zod";

// ─── Status Enums ──────────────────────────────────────────

export const ROSTER_TASK_STATUSES = [
  "detected",
  "gathering",
  "scoring",
  "reasoning",
  "contacting",
  "cascading",
  "accepted",
  "assigned",
  "escalated",
  "completed",
  "cancelled",
] as const;

export type RosterTaskStatus = (typeof ROSTER_TASK_STATUSES)[number];

export const TERMINAL_STATUSES: ReadonlySet<RosterTaskStatus> = new Set([
  "assigned",
  "escalated",
  "completed",
  "cancelled",
]);

export const URGENCY_LEVELS = ["planned", "urgent"] as const;
export type Urgency = (typeof URGENCY_LEVELS)[number];

export const CASCADE_STRATEGIES = ["sequential", "parallel"] as const;
export type CascadeStrategy = (typeof CASCADE_STRATEGIES)[number];

export const CONTACT_RESPONSES = ["pending", "accepted", "declined", "expired"] as const;
export type ContactResponse = (typeof CONTACT_RESPONSES)[number];

export const CONTACT_CHANNELS = ["sms", "email"] as const;
export type ContactChannel = (typeof CONTACT_CHANNELS)[number];

// ─── Interfaces ────────────────────────────────────────────

export interface ContactAttempt {
  employee_id: number;
  employee_name: string;
  contact_address: string; // Phone number (SMS) or email address
  rank: number;
  overall_score: number;
  channel: ContactChannel;
  sent_at: string;
  expires_at: string;
  response: ContactResponse;
  responded_at: string | null;
  decline_reason: string | null;
  selection_reason: string;
}

export interface AuditEntry {
  timestamp: string;
  action: string;
  actor: "system" | "llm" | string; // "system", "llm", or user ID
  details: Record<string, unknown>;
  reasoning?: string;
}

// ─── Urgency Config ────────────────────────────────────────

export interface UrgencyConfig {
  weightPreset: string;
  cascadeStrategy: CascadeStrategy;
  expiryMinutes: number;
  escalationThreshold: { type: "time"; minutes: number } | { type: "contacts"; count: number };
}

// ─── External Step Result ──────────────────────────────────

export interface StepResult {
  nextStatus: RosterTaskStatus;
  data: unknown;
}

// ─── Zod Schemas (API Validation) ──────────────────────────

export const CreateRosterTaskInput = z.object({
  visit_id: z.number().int().positive(),
  client_id: z.number().int().positive().optional(),
  urgency: z.enum(URGENCY_LEVELS).optional(),
});
export type CreateRosterTaskInputType = z.infer<typeof CreateRosterTaskInput>;

export const RosterTaskStatusFilter = z.object({
  status: z.enum(ROSTER_TASK_STATUSES).optional(),
  limit: z.number().int().min(1).max(100).optional().default(50),
  offset: z.number().int().min(0).optional().default(0),
});
export type RosterTaskStatusFilterType = z.infer<typeof RosterTaskStatusFilter>;
