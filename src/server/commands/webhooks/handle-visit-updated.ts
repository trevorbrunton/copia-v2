import { logger } from "@/src/lib/logger";
import { ValidationError } from "@/src/server/errors";
import { db } from "@/src/db";
import {
  findActiveTasksByVisit,
  updateRosterTask,
} from "@/src/services/rostering/roster-task-service";
import { appendAudit } from "@/src/services/rostering/audit-service";
import type { AlayaCareEvent } from "@/src/lib/alayacare-events/types";

const SYSTEM_USER_ID = "system";

/** Fields that trigger re-scoring when changed. */
const MATERIAL_FIELDS = new Set([
  "start_at", "end_at", "service_id", "requirements", "skills_required",
]);

export async function handleVisitUpdated(
  event: AlayaCareEvent,
  traceId: string,
): Promise<unknown> {
  const rawVisitId = Number(event.payload.visit_id);
  if (!Number.isInteger(rawVisitId) || rawVisitId <= 0) {
    throw new ValidationError("visit_id must be a positive integer");
  }

  // Check if the change is material (affects scoring)
  const changedFields = Array.isArray(event.payload.changed_fields)
    ? (event.payload.changed_fields as string[])
    : [];

  const materialChange = changedFields.some((f) => MATERIAL_FIELDS.has(f));

  logger.info(
    { traceId, visitId: rawVisitId, changedFields, materialChange },
    "Processing visit update"
  );

  if (!materialChange) {
    return { visit_id: rawVisitId, action: "no_rescore_needed", changed_fields: changedFields };
  }

  return db.transaction(async (tx) => {
    const activeTasks = await findActiveTasksByVisit(tx, SYSTEM_USER_ID, rawVisitId);

    if (activeTasks.length === 0) {
      return { visit_id: rawVisitId, action: "no_active_tasks" };
    }

    const rescoredIds: string[] = [];

    for (const task of activeTasks) {
      // Only re-score tasks that haven't been accepted yet
      if (task.status === "accepted") continue;

      try {
        await updateRosterTask(tx, SYSTEM_USER_ID, task.id, {
          status: "detected",
          matchResult: null,
          llmRecommendation: null,
          scoringCompletedAt: null,
        }, task.version);

        await appendAudit(tx, SYSTEM_USER_ID, task.id, {
          action: "visit_updated_rescore",
          actor: "system",
          details: { traceId, changedFields, previousStatus: task.status },
        });

        rescoredIds.push(task.id);
      } catch (err) {
        logger.error(
          { traceId, taskId: task.id, err: String(err) },
          "Failed to reset task for re-scoring"
        );
      }
    }

    return {
      visit_id: rawVisitId,
      action: "rescored",
      rescored_tasks: rescoredIds.length,
      rescored_task_ids: rescoredIds,
    };
  });
}
