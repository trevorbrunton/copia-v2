import { logger } from "@/src/lib/logger";
import { alayaCareCache, CACHE_KEY_EMPLOYEE_ROSTER } from "@/src/lib/alayacare-cache";
import { db } from "@/src/db";
import {
  findActiveTasksByEmployeeContact,
  updateRosterTask,
} from "@/src/services/rostering/roster-task-service";
import { appendAudit } from "@/src/services/rostering/audit-service";
import type { AlayaCareEvent } from "@/src/lib/alayacare-events/types";
import type { ContactAttempt } from "@/src/services/rostering/types";

const SYSTEM_USER_ID = "system";

export async function handleEmployeeUnavailability(
  event: AlayaCareEvent,
  traceId: string,
): Promise<unknown> {
  const { employee_id, unavailability_id } = event.payload;
  const employeeId = Number(employee_id);

  logger.info({ traceId, employeeId }, "Employee unavailability created");

  // Invalidate cached employee roster — unavailability affects scoring eligibility
  alayaCareCache.invalidate(CACHE_KEY_EMPLOYEE_ROSTER);

  return db.transaction(async (tx) => {
    const activeTasks = await findActiveTasksByEmployeeContact(tx, SYSTEM_USER_ID, employeeId);

    if (activeTasks.length === 0) {
      return { employee_id: employeeId, unavailability_id, action: "logged", affected_tasks: 0 };
    }

    const affectedIds: string[] = [];

    for (const task of activeTasks) {
      const contacts = (task.contacts ?? []) as ContactAttempt[];
      let modified = false;
      const updated = contacts.map((c) => {
        if (c.employee_id === employeeId && c.response === "pending") {
          modified = true;
          return { ...c, response: "expired" as const, responded_at: new Date().toISOString(), decline_reason: "Employee unavailable" };
        }
        return c;
      });

      if (!modified) continue;

      try {
        await updateRosterTask(tx, SYSTEM_USER_ID, task.id, {
          contacts: updated,
          status: "cascading",
        }, task.version);

        await appendAudit(tx, SYSTEM_USER_ID, task.id, {
          action: "employee_unavailable_cascade",
          actor: "system",
          details: { traceId, employeeId, unavailabilityId: unavailability_id, previousStatus: task.status },
        });

        affectedIds.push(task.id);
      } catch (err) {
        logger.error(
          { traceId, taskId: task.id, err: String(err) },
          "Failed to expire contacts for unavailable employee"
        );
      }
    }

    return {
      employee_id: employeeId,
      unavailability_id,
      action: affectedIds.length > 0 ? "contacts_expired" : "logged",
      affected_tasks: affectedIds.length,
      affected_task_ids: affectedIds,
    };
  });
}
