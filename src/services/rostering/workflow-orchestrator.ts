import type { AuthContext } from "@/src/server/auth-context";
import type { UnitOfWork } from "@/src/server/uow/types";
import type { TransactionClient } from "@/src/lib/tenant";
import type { RosterTask } from "@/src/db/schema";
import { rosterTasks } from "@/src/db/schema";
import type { StepResult, RosterTaskStatus } from "./types";
import { TERMINAL_STATUSES, ROSTER_TASK_STATUSES, URGENCY_LEVELS } from "./types";
import { getRosterTask, updateRosterTask } from "./roster-task-service";
import { appendAudit } from "./audit-service";
import { logger } from "@/src/lib/logger";
import { alayaFetch } from "@/src/lib/alayacare-client";
import { getRecommendation } from "@/src/services/reasoning/reasoning-service";
import { buildRecommendationContext } from "@/src/services/recommendation-context";
import type { LLMRecommendation } from "@/src/services/reasoning/types";
import type { MatchResult } from "@/src/services/scoring/types";
import {
  checkAndExpireContacts,
  advanceSequentialCascade,
  advanceParallelCascade,
  shouldEscalate,
} from "./cascade-engine";
import type { ContactAttempt, UrgencyConfig } from "./types";

/** Discriminated union for LLM recommendation or error fallback stored on task. */
export interface LLMRecommendationError {
  _tag: "error";
  reason: string;
  fallback_employee_id: number | null;
  fallback_employee_name: string | null;
}

type StoredRecommendation = LLMRecommendation | LLMRecommendationError;

function isRecommendationError(rec: unknown): rec is LLMRecommendationError {
  return rec != null && typeof rec === "object" && "_tag" in rec && (rec as LLMRecommendationError)._tag === "error";
}

/** P1.5.5: Minimum viable candidates before auto-escalation (thin bench). */
export const MIN_VIABLE_CANDIDATES = 3;

/**
 * Main orchestration pipeline — called when a task needs to advance.
 *
 * External API calls (AlayaCare, Bedrock LLM) run OUTSIDE the UoW transaction
 * to avoid holding DB connections during network I/O:
 *   1. Read task state inside UoW
 *   2. Run external calls outside UoW (compute, fetch, LLM)
 *   3. Persist results inside UoW (with optimistic lock check)
 */
export async function advanceTask(
  deps: { uow: UnitOfWork },
  ctx: AuthContext,
  taskId: string
): Promise<RosterTask> {
  // Phase 1: Read current state (inside UoW)
  const task = await deps.uow.run(ctx, async (txCtx) => {
    return getRosterTask(txCtx.db, ctx.principalId, taskId);
  });

  if (TERMINAL_STATUSES.has(task.status as RosterTaskStatus)) {
    logger.debug({ taskId, status: task.status }, "Task in terminal state — no advancement");
    return task;
  }

  // Phase 2: Run external calls OUTSIDE UoW (no DB transaction held)
  const externalResult = await runExternalStep(task);

  // Phase 3: Re-read task (fresh version) and persist results with optimistic lock
  return deps.uow.run(ctx, async (txCtx) => {
    const freshTask = await getRosterTask(txCtx.db, ctx.principalId, taskId);

    // Re-check terminal status after fresh read (fix TOCTOU gap)
    if (TERMINAL_STATUSES.has(freshTask.status as RosterTaskStatus)) {
      logger.debug({ taskId, status: freshTask.status }, "Task became terminal between phases — skipping persist");
      return freshTask;
    }

    return persistStepResult(txCtx.db, ctx.principalId, freshTask, externalResult);
  });
}

/**
 * External calls — no tx parameter, no DB connection held.
 * scoring → reasoning: calls LLM with fallback
 * reasoning → contacting/escalated: escalation decision flow
 */
async function runExternalStep(task: RosterTask): Promise<StepResult> {
  switch (task.status) {
    case "detected":
      return { nextStatus: "gathering", data: null };

    case "gathering":
      return { nextStatus: "scoring", data: null };

    case "scoring":
      return reasonAboutMatch(task);

    case "reasoning":
      return initiateContact(task);

    case "contacting":
      return handleContacting(task);

    case "cascading":
      return handleCascading(task);

    case "accepted":
      return handleAccepted(task);

    default:
      throw new Error(`Unhandled task status: ${task.status}`);
  }
}

/** Resolve urgency with runtime validation and fallback. */
function resolveUrgency(raw: string | null | undefined): "planned" | "urgent" {
  if (raw && (URGENCY_LEVELS as readonly string[]).includes(raw)) {
    return raw as "planned" | "urgent";
  }
  return "planned";
}

/**
 * P1.2.1 + P1.2.4: Call LLM reasoning with fallback on failure.
 * Stores full LLMRecommendation on the task record.
 */
async function reasonAboutMatch(task: RosterTask): Promise<StepResult> {
  const matchResult = task.matchResult as MatchResult | null;

  // No candidates → escalate immediately (no actionable data to contact)
  if (!matchResult || !matchResult.candidates?.length) {
    return {
      nextStatus: "escalated",
      data: { escalationReason: "No match result or eligible candidates" },
    };
  }

  // P1.5.5: Fewer than 3 viable candidates → escalate (thin bench)
  if (matchResult.candidates.length < MIN_VIABLE_CANDIDATES) {
    return {
      nextStatus: "escalated",
      data: { escalationReason: `Only ${matchResult.candidates.length} candidate(s) — thin bench, needs human review` },
    };
  }

  try {
    const ctxResult = await buildRecommendationContext(
      task.visitId,
      matchResult,
      resolveUrgency(task.urgency),
    );

    const recommendation = await getRecommendation({
      visit: ctxResult.visit,
      client: ctxResult.client,
      matchResult,
      context: ctxResult.context,
    });

    return {
      nextStatus: "reasoning",
      data: { llmRecommendation: recommendation },
    };
  } catch (err) {
    // P1.2.4: Fallback to scoring-only — don't block on LLM failure
    logger.error(
      { taskId: task.id, err: String(err) },
      "LLM reasoning failed — falling back to scoring-only"
    );

    const topCandidate = matchResult.candidates[0];
    const fallback: LLMRecommendationError = {
      _tag: "error",
      reason: "LLM service unavailable",
      fallback_employee_id: topCandidate?.employee_id ?? null,
      fallback_employee_name: topCandidate?.employee_name ?? null,
    };
    return {
      nextStatus: "reasoning",
      data: { llmRecommendation: fallback },
    };
  }
}

/**
 * P1.2.2: Escalation decision flow based on LLM recommendation.
 *
 * Routes:
 * - should_escalate + urgency "immediate" → ESCALATED
 * - should_escalate + urgency "before_shift" → CONTACTING (with escalation flag)
 * - should_escalate + urgency "informational" → CONTACTING (with note)
 * - no escalation → CONTACTING normally
 */
function initiateContact(task: RosterTask): StepResult {
  const rec = task.llmRecommendation as StoredRecommendation | null;

  // If no recommendation or error fallback, advance to contacting
  if (!rec || isRecommendationError(rec)) {
    return { nextStatus: "contacting", data: null };
  }

  const { escalation, primary } = rec;

  if (escalation.should_escalate && escalation.urgency === "immediate") {
    return {
      nextStatus: "escalated",
      data: { escalationReason: escalation.reason },
    };
  }

  // P1.5.5: Low confidence on top candidate → escalate for human review
  if (primary.confidence === "low") {
    return {
      nextStatus: "escalated",
      data: { escalationReason: "LLM confidence is low on all candidates — needs human review" },
    };
  }

  // before_shift and informational: proceed to contacting (escalation info stored in audit)
  return { nextStatus: "contacting", data: null };
}

// ─── Urgency Config ─────────────────────────────────────────
// Single source of truth: urgency-classifier.ts — avoids duplicate configs

import { getUrgencyConfig as getCanonicalUrgencyConfig } from "./urgency-classifier";

function getUrgencyConfig(task: RosterTask): UrgencyConfig {
  return getCanonicalUrgencyConfig(resolveUrgency(task.urgency));
}

// ─── Contacting: check expiry, advance cascade ─────────────

function handleContacting(task: RosterTask): StepResult {
  const { contacts, shouldCascade } = checkAndExpireContacts(task);

  if (!shouldCascade) {
    // No expiry yet — task stays in contacting (polling will re-check)
    return { nextStatus: "contacting", data: null };
  }

  // Contact expired — cascade to next
  return {
    nextStatus: "cascading",
    data: { contacts },
  };
}

// ─── Accepted: AlayaCare write-back ──────────────────────────

async function handleAccepted(task: RosterTask): Promise<StepResult> {
  const employeeId = task.assignedEmployeeId;

  if (!employeeId) {
    logger.error({ taskId: task.id }, "Accepted task has no assignedEmployeeId — escalating");
    return {
      nextStatus: "escalated",
      data: { escalationReason: "Accepted but no employee ID recorded" },
    };
  }

  try {
    await alayaFetch(`/scheduler/visits/${task.visitId}/offers`, {
      method: "POST",
      body: { employee_id: employeeId },
    });

    return {
      nextStatus: "completed",
      data: { writeBackSuccess: true },
    };
  } catch (err) {
    // Write-back failed — move to assigned (manual follow-up needed)
    logger.error(
      { taskId: task.id, visitId: task.visitId, employeeId, err: String(err) },
      "AlayaCare write-back failed — marking assigned for manual follow-up"
    );

    return {
      nextStatus: "assigned",
      data: { escalationReason: `AlayaCare write-back failed: ${String(err)}` },
    };
  }
}

// ─── Cascading: advance to next candidate or escalate ───────

function handleCascading(task: RosterTask): StepResult {
  const config = getUrgencyConfig(task);

  // Check escalation threshold first
  if (shouldEscalate(task, config)) {
    return {
      nextStatus: "escalated",
      data: { escalationReason: "Cascade exhausted — escalation threshold reached" },
    };
  }

  if (config.cascadeStrategy === "parallel") {
    const result = advanceParallelCascade(task);

    if (result.acceptedIndex !== null) {
      const contacts = (task.contacts ?? []) as ContactAttempt[];
      return {
        nextStatus: "accepted",
        data: {
          assignedEmployeeId: contacts[result.acceptedIndex].employee_id,
          cancelledIndices: result.cancelledIndices,
        },
      };
    }

    if (result.shouldEscalate) {
      return {
        nextStatus: "escalated",
        data: { escalationReason: "All parallel contacts exhausted" },
      };
    }

    // Still waiting for parallel responses
    return { nextStatus: "cascading", data: null };
  }

  // Sequential cascade
  const result = advanceSequentialCascade(task);

  if (result.shouldEscalate) {
    return {
      nextStatus: "escalated",
      data: { escalationReason: "All sequential contacts exhausted" },
    };
  }

  // Advance to next candidate
  return {
    nextStatus: "contacting",
    data: { currentContactIndex: result.nextContactIndex },
  };
}

/**
 * Persist results — inside UoW, checks version for optimistic locking.
 */
async function persistStepResult(
  db: TransactionClient,
  userId: string,
  task: RosterTask,
  result: StepResult
): Promise<RosterTask> {
  const updates: Partial<typeof rosterTasks.$inferInsert> = {
    status: result.nextStatus,
  };

  // Apply data from step results
  if (result.data && typeof result.data === "object") {
    const data = result.data as Record<string, unknown>;
    if (data.llmRecommendation) {
      updates.llmRecommendation = data.llmRecommendation;
    }
    if (data.escalationReason) {
      updates.escalationReason = data.escalationReason as string;
    }
    if (data.contacts) {
      updates.contacts = data.contacts;
    }
    if (typeof data.currentContactIndex === "number") {
      updates.currentContactIndex = data.currentContactIndex;
    }
    if (typeof data.assignedEmployeeId === "number") {
      updates.assignedEmployeeId = data.assignedEmployeeId;
    }
    // Cancel remaining pending contacts after parallel accept
    if (Array.isArray(data.cancelledIndices) && data.cancelledIndices.length > 0) {
      const currentContacts = (updates.contacts ?? task.contacts ?? []) as ContactAttempt[];
      const cancelled = [...currentContacts];
      for (const idx of data.cancelledIndices as number[]) {
        if (cancelled[idx]?.response === "pending") {
          cancelled[idx] = {
            ...cancelled[idx],
            response: "expired",
            responded_at: new Date().toISOString(),
          };
        }
      }
      updates.contacts = cancelled;
    }
  }

  if (task.status === "scoring" && result.nextStatus === "reasoning") {
    updates.scoringCompletedAt = new Date();
  }
  if (result.nextStatus === "contacting") {
    // Preserve existing firstContactAt from DB record
    updates.firstContactAt = task.firstContactAt ?? new Date();
  }
  if (
    result.nextStatus === "completed" ||
    result.nextStatus === "assigned" ||
    result.nextStatus === "escalated"
  ) {
    updates.resolvedAt = new Date();
    updates.timeToFillMs = task.detectedAt
      ? Date.now() - new Date(task.detectedAt).getTime()
      : null;
  }

  const updated = await updateRosterTask(
    db,
    userId,
    task.id,
    updates,
    task.version
  );

  await appendAudit(db, userId, task.id, {
    action: `${task.status}_to_${result.nextStatus}`,
    actor: "system",
    details: { previousStatus: task.status, newStatus: result.nextStatus },
  });

  logger.info(
    { taskId: task.id, from: task.status, to: result.nextStatus },
    "Task state transition"
  );

  return updated;
}
