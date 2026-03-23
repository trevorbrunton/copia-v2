import { z } from "zod";
import type { AuthContext } from "../../auth-context";
import type { UnitOfWork } from "../../uow/types";
import { ConflictError } from "../../errors";
import { getUser } from "@/src/services/user-service";
import { softDeleteUser } from "@/src/services/user-lifecycle-service";

export const DeleteAccountInput = z.object({
  confirm: z.literal("DELETE"),
});

export async function handleDeleteAccount(
  deps: { uow: UnitOfWork },
  rawInput: unknown,
  ctx: AuthContext,
  ipAddress: string
) {
  DeleteAccountInput.parse(rawInput);

  return deps.uow.run(ctx, async ({ db: tx }) => {
    const user = await getUser(tx, ctx.principalId);
    if (!user || user.status !== "active") {
      throw new ConflictError(
        `Cannot delete account: current status is '${user?.status ?? "not found"}'`
      );
    }

    return softDeleteUser(
      tx,
      ctx.principalId,
      "Self-service account deletion",
      ipAddress
    );
  });
}
