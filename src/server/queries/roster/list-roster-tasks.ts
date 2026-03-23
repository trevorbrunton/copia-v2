import type { AuthContext } from "../../auth-context";
import type { ReadOnlyExecutor } from "../../uow/types";
import { RosterTaskStatusFilter } from "@/src/services/rostering/types";
import { listRosterTasks } from "@/src/services/rostering/roster-task-service";

export async function handleListRosterTasks(
  deps: { readOnly: ReadOnlyExecutor },
  rawInput: unknown,
  ctx: AuthContext
) {
  const filter = RosterTaskStatusFilter.parse(rawInput ?? {});
  return deps.readOnly.run(ctx, async ({ db: tx }) => {
    return listRosterTasks(tx, ctx.principalId, filter);
  });
}
