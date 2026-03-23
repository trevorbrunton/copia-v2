import type { AuthContext } from "../../auth-context";
import type { UnitOfWork } from "../../uow/types";
import { z } from "zod";
import { advanceTask } from "@/src/services/rostering/workflow-orchestrator";

const AdvanceTaskInput = z.object({
  taskId: z.string().uuid(),
});

export async function handleAdvanceRosterTask(
  deps: { uow: UnitOfWork },
  rawInput: unknown,
  ctx: AuthContext
) {
  const { taskId } = AdvanceTaskInput.parse(rawInput);
  return advanceTask(deps, ctx, taskId);
}
