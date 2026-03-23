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

export async function handleEmployeeStatusChanged(
  event: AlayaCareEvent,
  traceId: string,
): Promise<unknown> {
  const { employee_id, status } = event.payload;
  const employeeId = Number(employee_id);

  logger.info({ traceId, employeeId, status }, "Employee status changed");

  // Invalidate cached employee roster — status change affects scoring eligibility
  alayaCareCache.invalidate(CACHE_KEY_EMPLOYEE_ROSTER);

  if (status !== "terminated") {
    return { employee_id: employeeId, status, action: "logged" };
  }

  // P1.6.1: Terminated employee — expire their pending contacts and advance cascade
  logger.info({ traceId, employeeId }, "Employee terminated — expiring active contacts");

  return db.transaction(async (tx) => {
    const activeTasks = await findActiveTasksByEmployeeContact(tx, SYSTEM_USER_ID, employeeId);

    if (activeTasks.length === 0) {
      return { employee_id: employeeId, action: "resignation_detected", affected_tasks: 0 };
    }

    const affectedIds: string[] = [];

    for (const task of activeTasks) {
      const contacts = (task.contacts ?? []) as ContactAttempt[];
      let modified = false;
      const updated = contacts.map((c) => {
        if (c.employee_id === employeeId && c.response === "pending") {
          modified = true;
          return { ...c, response: "expired" as const, responded_at: new Date().toISOString(), decline_reason: "Employee terminated" };
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
          action: "employee_terminated_cascade",
          actor: "system",
          details: { traceId, employeeId, previousStatus: task.status },
        });

        affectedIds.push(task.id);
      } catch (err) {
        logger.error(
          { traceId, taskId: task.id, err: String(err) },
          "Failed to expire contacts for terminated employee"
        );
      }
    }

    return {
      employee_id: employeeId,
      action: "resignation_detected",
      affected_tasks: affectedIds.length,
      affected_task_ids: affectedIds,
    };
  });
}
