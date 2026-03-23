import type { AuthContext } from "../../auth-context";
import type { ReadOnlyExecutor } from "../../uow/types";
import { getUser } from "@/src/services/user-service";
import { NotFoundError } from "../../errors";

export async function handleGetProfile(
  deps: { readOnly: ReadOnlyExecutor },
  ctx: AuthContext
) {
  return deps.readOnly.run(ctx, async ({ db: tx }) => {
    const user = await getUser(tx, ctx.principalId);
    if (!user) throw new NotFoundError("User");
    return user;
  });
}
