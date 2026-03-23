import type { AuthContext } from "../../auth-context";
import type { UnitOfWork } from "../../uow/types";
import { updateUser } from "@/src/services/user-service";
import { profileUpdateSchema } from "@/src/auth/validation";

export const UpdateProfileInput = profileUpdateSchema;

export async function handleUpdateProfile(
  deps: { uow: UnitOfWork },
  rawInput: unknown,
  ctx: AuthContext
) {
  const input = UpdateProfileInput.parse(rawInput);

  return deps.uow.run(ctx, async ({ db: tx }) => {
    return updateUser(tx, ctx.principalId, input);
  });
}
