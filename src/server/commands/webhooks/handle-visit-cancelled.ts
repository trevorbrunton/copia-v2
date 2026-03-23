import { logger } from "@/src/lib/logger";
import { ValidationError } from "@/src/server/errors";
import { db } from "@/src/db";
import {
  findActiveTasksByVisit,
  updateRosterTask,
} from "@/src/services/rostering/roster-task-service";
import { appendAudit } from "@/src/services/rostering/audit-service";
import type { AlayaCareEvent } from "@/src/lib/alayacare-events/types";

/**
 * Handle visit.cancelled — cancel all active roster tasks for this visit.
 *
 * Note: Webhook handlers run in M2M context (no AuthContext).
 * We use a system user ID for service-level operations.
 * In production, this would resolve the visit owner from AlayaCare.
 */
const SYSTEM_USER_ID = "system";

export async function handleVisitCancelled(
  event: AlayaCareEvent,
  traceId: string,
): Promise<unknown> {
  const rawVisitId = Number(event.payload.visit_id);
  if (!Number.isInteger(rawVisitId) || rawVisitId <= 0) {
    throw new ValidationError("visit_id must be a positive integer");
  }

  const reason = typeof event.payload.reason === "string"
    ? event.payload.reason
    : "Visit cancelled via AlayaCare";

  logger.info({ traceId, visitId: rawVisitId }, "Processing visit cancellation");

  return db.transaction(async (tx) => {
    const activeTasks = await findActiveTasksByVisit(tx, SYSTEM_USER_ID, rawVisitId);

    if (activeTasks.length === 0) {
      logger.info({ traceId, visitId: rawVisitId }, "No active tasks for cancelled visit");
      return { visit_id: rawVisitId, cancelled_tasks: 0 };
    }

    const cancelledIds: string[] = [];

    for (const task of activeTasks) {
      try {
        await updateRosterTask(tx, SYSTEM_USER_ID, task.id, {
          status: "cancelled",
          escalationReason: reason,
          resolvedAt: new Date(),
          timeToFillMs: task.detectedAt
            ? Date.now() - new Date(task.detectedAt).getTime()
            : null,
        }, task.version);

        await appendAudit(tx, SYSTEM_USER_ID, task.id, {
          action: "visit_cancelled",
          actor: "system",
          details: { traceId, reason, previousStatus: task.status },
        });

        cancelledIds.push(task.id);
      } catch (err) {
        logger.error(
          { traceId, taskId: task.id, err: String(err) },
          "Failed to cancel task for cancelled visit"
        );
      }
    }

    logger.info(
      { traceId, visitId: rawVisitId, cancelledCount: cancelledIds.length },
      "Cancelled tasks for visit"
    );

    return {
      visit_id: rawVisitId,
      cancelled_tasks: cancelledIds.length,
      cancelled_task_ids: cancelledIds,
    };
  });
}
