import { z } from "zod";
import type { AuthContext } from "../../auth-context";
import type { UnitOfWork } from "../../uow/types";
import { removeDevice } from "@/src/services/session-service";

export const RemoveDeviceInput = z.object({
  id: z.string().uuid(),
});

export async function handleRemoveDevice(
  deps: { uow: UnitOfWork },
  deviceId: string,
  ctx: AuthContext
) {
  const { id } = RemoveDeviceInput.parse({ id: deviceId });

  return deps.uow.run(ctx, async ({ db: tx }) => {
    await removeDevice(tx, ctx.principalId, id);
  });
}
