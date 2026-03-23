import type { AuthContext } from "../../auth-context";
import type { ReadOnlyExecutor } from "../../uow/types";
import { z } from "zod";
import { getRosterTask } from "@/src/services/rostering/roster-task-service";
import { getAuditTrail } from "@/src/services/rostering/audit-service";

const GetTaskInput = z.object({
  taskId: z.string().uuid(),
});

export async function handleGetRosterTask(
  deps: { readOnly: ReadOnlyExecutor },
  rawInput: unknown,
  ctx: AuthContext
) {
  const { taskId } = GetTaskInput.parse(rawInput);
  return deps.readOnly.run(ctx, async ({ db: tx }) => {
    const task = await getRosterTask(tx, ctx.principalId, taskId);
    const auditTrail = await getAuditTrail(tx, ctx.principalId, taskId);
    return { ...task, auditTrail };
  });
}
