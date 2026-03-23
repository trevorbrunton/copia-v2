import type { AuthContext } from "../../auth-context";
import type { ReadOnlyExecutor } from "../../uow/types";
import { listActiveSessions } from "@/src/services/session-service";

export async function handleListSessions(
  deps: { readOnly: ReadOnlyExecutor },
  ctx: AuthContext
) {
  return deps.readOnly.run(ctx, async ({ db: tx }) => {
    return listActiveSessions(tx, ctx.principalId);
  });
}
