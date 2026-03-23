import { eq, and, isNotNull, sql } from "drizzle-orm";
import type { AuthContext } from "../../auth-context";
import type { UnitOfWork } from "../../uow/types";
import { workflowEvents, rosterTasks } from "@/src/db/schema";
import { createRosterTask } from "@/src/services/rostering/roster-task-service";
import { appendAudit } from "@/src/services/rostering/audit-service";
import { advanceTask } from "@/src/services/rostering/workflow-orchestrator";
import { logger } from "@/src/lib/logger";

const BATCH_LIMIT = 50;

/**
 * Two-phase event processor (P9 decision).
 * Reads completed workflow_events with results that don't yet have
 * a corresponding roster_task (source_event_id match).
 * Creates user-scoped RosterTasks within UoW, then advances each.
 */
export async function handleProcessPendingEvents(
  deps: { uow: UnitOfWork },
  _rawInput: unknown,
  ctx: AuthContext
): Promise<{ processed: number; tasks: string[] }> {
  // Step 1: Find unprocessed events (bounded to BATCH_LIMIT)
  const pendingEvents = await deps.uow.run(ctx, async ({ db: tx }) => {
    return tx
      .select()
      .from(workflowEvents)
      .where(
        and(
          eq(workflowEvents.status, "completed"),
          isNotNull(workflowEvents.result),
          sql`NOT EXISTS (
            SELECT 1 FROM roster_tasks
            WHERE roster_tasks.source_event_id = ${workflowEvents.eventId}
          )`
        )
      )
      .limit(BATCH_LIMIT);
  });

  if (pendingEvents.length === 0) {
    return { processed: 0, tasks: [] };
  }

  logger.info(
    { count: pendingEvents.length, traceId: ctx.traceId },
    "Processing pending workflow events"
  );

  // Step 2: Batch-create all RosterTasks in a single UoW transaction
  const taskIds = await deps.uow.run(ctx, async ({ db: tx }) => {
    const ids: string[] = [];
    for (const event of pendingEvents) {
      const result = event.result as Record<string, unknown> | null;
      const payload = event.payload as Record<string, unknown>;
      const created = await createRosterTask(tx, ctx.principalId, {
        visit_id: (payload.visit_id as number) ?? 0,
        client_id: payload.client_id as number | undefined,
        sourceEventId: event.eventId,
        matchResult: result?.matchResult,
        llmRecommendation: result?.recommendation,
        status: result?.matchResult ? "reasoning" : "detected",
      });

      await appendAudit(tx, ctx.principalId, created.id, {
        action: "task_created_from_event",
        actor: "system",
        details: {
          eventId: event.eventId,
          eventType: event.eventType,
          trigger: "webhook_two_phase",
        },
      });

      ids.push(created.id);
    }
    return ids;
  });

  // Step 3: Advance all tasks concurrently (each opens its own UoW transactions)
  const advanceResults = await Promise.allSettled(
    taskIds.map((taskId) => advanceTask(deps, ctx, taskId))
  );

  for (let i = 0; i < advanceResults.length; i++) {
    const result = advanceResults[i];
    if (result.status === "rejected") {
      logger.error(
        { taskId: taskIds[i], err: String(result.reason), traceId: ctx.traceId },
        "Failed to advance task after creation"
      );
    }
  }

  return { processed: pendingEvents.length, tasks: taskIds };
}
