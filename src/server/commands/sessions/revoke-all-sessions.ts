import { z } from "zod";
import type { AuthContext } from "../../auth-context";
import type { UnitOfWork } from "../../uow/types";
import { revokeAllSessions } from "@/src/services/session-service";

export const RevokeAllSessionsInput = z.object({
  currentSessionId: z.string().uuid().optional(),
});

export async function handleRevokeAllSessions(
  deps: { uow: UnitOfWork },
  rawInput: unknown,
  ctx: AuthContext
) {
  const input = RevokeAllSessionsInput.parse(rawInput);

  return deps.uow.run(ctx, async ({ db: tx }) => {
    const count = await revokeAllSessions(
      tx,
      ctx.principalId,
      input.currentSessionId
    );
    return { revoked: count };
  });
}
