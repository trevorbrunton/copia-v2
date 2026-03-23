import { z } from "zod";
import type { AuthContext } from "@/src/server/auth-context";
import type { UnitOfWork } from "@/src/server/uow/types";
import type { RosterTask } from "@/src/db/schema";
import { getRosterTask, updateRosterTask } from "@/src/services/rostering/roster-task-service";
import { appendAudit } from "@/src/services/rostering/audit-service";
import { ConflictError } from "@/src/server/errors";
import { logger } from "@/src/lib/logger";

export const HumanActionInput = z.object({
  action: z.enum(["accept_recommendation", "assign_manually", "defer", "take_over", "cancel"]),
  employee_id: z.number().int().positive().optional(),
  reason: z.string().optional(),
}).refine(
  (d) => d.action !== "assign_manually" || d.employee_id != null,
  { message: "employee_id required for assign_manually" },
).refine(
  (d) => d.action !== "cancel" || (d.reason != null && d.reason.length > 0),
  { message: "reason required for cancel" },
);

type HumanActionInputType = z.infer<typeof HumanActionInput>;

/**
 * Handle a human intervention action on an escalated roster task.
 * Only escalated tasks can receive human actions (except defer which is a no-op).
 */
export async function handleHumanAction(
  deps: { uow: UnitOfWork },
  rawInput: { taskId: string; action: string; employee_id?: number; reason?: string },
  ctx: AuthContext,
): Promise<RosterTask> {
  const input = HumanActionInput.parse(rawInput);

  return deps.uow.run(ctx, async ({ db: tx }) => {
    const task = await getRosterTask(tx, ctx.principalId, rawInput.taskId);

    // Only escalated tasks accept human actions
    if (task.status !== "escalated") {
      throw new ConflictError("Task must be in escalated state for human actions");
    }

    const result = applyAction(task, input, ctx.principalId);

    let updated = task;
    if (result.updates) {
      updated = await updateRosterTask(
        tx,
        ctx.principalId,
        task.id,
        result.updates,
        task.version,
      );
    }

    await appendAudit(tx, ctx.principalId, task.id, {
      action: `human_${input.action}`,
      actor: ctx.principalId,
      details: {
        action: input.action,
        employee_id: input.employee_id,
        reason: input.reason,
      },
    });

    logger.info(
      { taskId: task.id, action: input.action, actor: ctx.principalId },
      "Human action applied",
    );

    return updated;
  });
}

function applyAction(
  task: RosterTask,
  input: HumanActionInputType,
  userId: string,
): { updates: Partial<typeof import("@/src/db/schema").rosterTasks.$inferInsert> | null } {
  switch (input.action) {
    case "accept_recommendation":
      return {
        updates: {
          status: "contacting",
        },
      };

    case "assign_manually":
      return {
        updates: {
          status: "accepted",
          assignedEmployeeId: input.employee_id!,
        },
      };

    case "defer":
      // No state change — just audit entry
      return { updates: null };

    case "take_over":
      return {
        updates: {
          status: "assigned",
          escalatedTo: userId,
          resolvedAt: new Date(),
          timeToFillMs: task.detectedAt
            ? Date.now() - new Date(task.detectedAt).getTime()
            : null,
        },
      };

    case "cancel":
      return {
        updates: {
          status: "cancelled",
          escalationReason: input.reason,
          resolvedAt: new Date(),
          timeToFillMs: task.detectedAt
            ? Date.now() - new Date(task.detectedAt).getTime()
            : null,
        },
      };
  }
}
