import { z } from "zod";
import type { AuthContext } from "../../auth-context";
import type { UnitOfWork } from "../../uow/types";
import {
  revokeSession,
  endSession,
  heartbeat,
} from "@/src/services/session-service";

export const SessionIdInput = z.object({
  id: z.string().uuid(),
});

export const DeleteSessionInput = z.object({
  action: z.enum(["revoke", "end"]).optional().default("revoke"),
});

export async function handleDeleteSession(
  deps: { uow: UnitOfWork },
  sessionId: string,
  rawInput: unknown,
  ctx: AuthContext
) {
  const { id } = SessionIdInput.parse({ id: sessionId });
  const { action } = DeleteSessionInput.parse(rawInput);

  return deps.uow.run(ctx, async ({ db: tx }) => {
    if (action === "end") {
      await endSession(tx, ctx.principalId, id);
    } else {
      await revokeSession(tx, ctx.principalId, id);
    }
  });
}

export async function handleHeartbeat(
  deps: { uow: UnitOfWork },
  sessionId: string,
  ctx: AuthContext
) {
  const { id } = SessionIdInput.parse({ id: sessionId });

  return deps.uow.run(ctx, async ({ db: tx }) => {
    await heartbeat(tx, ctx.principalId, id);
    return { ok: true };
  });
}
