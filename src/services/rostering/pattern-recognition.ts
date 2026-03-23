import { rosterTasks } from "@/src/db/schema";
import { eq, and, sql, gte, inArray } from "drizzle-orm";
import type { TransactionClient } from "@/src/lib/tenant";
import type { ContactAttempt } from "./types";
import { logger } from "@/src/lib/logger";

export type PatternType =
  | "always_declines"
  | "never_accepts"
  | "preset_performance"
  | "client_churn";

export interface PatternInsight {
  type: PatternType;
  description: string;
  evidence: Record<string, unknown>;
  recommendation: string;
}

const LOOKBACK_DAYS = 30;
const MIN_CONTACTS_FOR_PATTERN = 3;

/**
 * Analyse completed roster tasks to detect patterns.
 * Runs on a schedule (daily or weekly) per user.
 */
export async function analysePatterns(
  tx: TransactionClient,
  userId: string,
): Promise<PatternInsight[]> {
  const insights: PatternInsight[] = [];
  const since = new Date();
  since.setDate(since.getDate() - LOOKBACK_DAYS);

  // Fetch recent resolved tasks
  const tasks = await tx
    .select({
      id: rosterTasks.id,
      clientId: rosterTasks.clientId,
      status: rosterTasks.status,
      contacts: rosterTasks.contacts,
      assignedEmployeeId: rosterTasks.assignedEmployeeId,
    })
    .from(rosterTasks)
    .where(and(
      eq(rosterTasks.userId, userId),
      gte(rosterTasks.createdAt, since),
      inArray(rosterTasks.status, ["assigned", "completed", "escalated"]),
    ));

  if (tasks.length === 0) return insights;

  // Build contact frequency maps
  const employeeDeclines = new Map<number, { name: string; declines: number; accepts: number; contacts: number }>();
  const clientCaregivers = new Map<number, Set<number>>();

  for (const task of tasks) {
    const contacts = (task.contacts ?? []) as ContactAttempt[];

    // Track client → unique caregivers
    if (task.clientId && task.assignedEmployeeId) {
      if (!clientCaregivers.has(task.clientId)) {
        clientCaregivers.set(task.clientId, new Set());
      }
      clientCaregivers.get(task.clientId)!.add(task.assignedEmployeeId);
    }

    // Track employee decline patterns
    for (const contact of contacts) {
      const existing = employeeDeclines.get(contact.employee_id) ?? {
        name: contact.employee_name,
        declines: 0,
        accepts: 0,
        contacts: 0,
      };
      existing.contacts++;
      if (contact.response === "declined") {
        existing.declines++;
      } else if (contact.response === "accepted") {
        existing.accepts++;
      }
      employeeDeclines.set(contact.employee_id, existing);
    }
  }

  // Pattern: always_declines — employee declines ≥80% of contacts
  for (const [empId, stats] of employeeDeclines) {
    if (stats.contacts < MIN_CONTACTS_FOR_PATTERN) continue;
    const declineRate = stats.declines / stats.contacts;
    if (declineRate >= 0.8) {
      insights.push({
        type: "always_declines",
        description: `${stats.name} (ID: ${empId}) declined ${stats.declines}/${stats.contacts} shift offers (${Math.round(declineRate * 100)}%)`,
        evidence: { employee_id: empId, declines: stats.declines, total: stats.contacts, rate: declineRate },
        recommendation: `Consider deprioritising ${stats.name} in candidate scoring or reviewing their availability settings.`,
      });
    }
  }

  // Pattern: never_accepts — employee contacted multiple times, zero accepts
  for (const [empId, stats] of employeeDeclines) {
    if (stats.contacts < MIN_CONTACTS_FOR_PATTERN) continue;
    // Skip if already flagged as always_declines (superset pattern)
    if (stats.declines / stats.contacts >= 0.8) continue;
    if (stats.accepts === 0) {
      insights.push({
        type: "never_accepts",
        description: `${stats.name} (ID: ${empId}) has never accepted any of ${stats.contacts} offers`,
        evidence: { employee_id: empId, contacts: stats.contacts },
        recommendation: `Flag ${stats.name} for review — they may be marked available but aren't actually taking shifts.`,
      });
    }
  }

  // Pattern: client_churn — client has many unique caregivers (≥5 in lookback period)
  for (const [clientId, caregivers] of clientCaregivers) {
    if (caregivers.size >= 5) {
      insights.push({
        type: "client_churn",
        description: `Client ${clientId} had ${caregivers.size} different caregivers in the last ${LOOKBACK_DAYS} days`,
        evidence: { client_id: clientId, unique_caregivers: caregivers.size, period_days: LOOKBACK_DAYS },
        recommendation: `High caregiver turnover for client ${clientId}. Consider prioritising relationship scoring for this client.`,
      });
    }
  }

  // Pattern: preset_performance — compare escalation rates
  const escalated = tasks.filter((t) => t.status === "escalated").length;
  const total = tasks.length;
  const escalationRate = total > 0 ? escalated / total : 0;

  if (escalationRate > 0.3 && total >= 5) {
    insights.push({
      type: "preset_performance",
      description: `Escalation rate is ${Math.round(escalationRate * 100)}% (${escalated}/${total} tasks) over the last ${LOOKBACK_DAYS} days`,
      evidence: { escalated, total, rate: escalationRate, period_days: LOOKBACK_DAYS },
      recommendation: "Consider reviewing weight presets — high escalation rate may indicate suboptimal candidate scoring.",
    });
  }

  logger.info({ userId, insightCount: insights.length }, "Pattern analysis complete");
  return insights;
}
