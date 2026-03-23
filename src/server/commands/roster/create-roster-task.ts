import type { AuthContext } from "../../auth-context";
import type { UnitOfWork } from "../../uow/types";
import { CreateRosterTaskInput } from "@/src/services/rostering/types";
import { createRosterTask } from "@/src/services/rostering/roster-task-service";
import { appendAudit } from "@/src/services/rostering/audit-service";

export async function handleCreateRosterTask(
  deps: { uow: UnitOfWork },
  rawInput: unknown,
  ctx: AuthContext
) {
  const input = CreateRosterTaskInput.parse(rawInput);

  return deps.uow.run(ctx, async ({ db: tx }) => {
    const task = await createRosterTask(tx, ctx.principalId, input);

    await appendAudit(tx, ctx.principalId, task.id, {
      action: "task_created",
      actor: ctx.principalId,
      details: { visitId: input.visit_id, urgency: input.urgency ?? "planned", trigger: "manual" },
    });

    return task;
  });
}
