import type { AuthContext } from "../../auth-context";
import type { ReadOnlyExecutor } from "../../uow/types";
import { listDevices } from "@/src/services/session-service";

export async function handleListDevices(
  deps: { readOnly: ReadOnlyExecutor },
  ctx: AuthContext
) {
  return deps.readOnly.run(ctx, async ({ db: tx }) => {
    return listDevices(tx, ctx.principalId);
  });
}
