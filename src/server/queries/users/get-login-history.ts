import { z } from "zod";
import type { AuthContext } from "../../auth-context";
import type { ReadOnlyExecutor } from "../../uow/types";
import { getLoginHistory } from "@/src/services/session-service";

export const LoginHistoryInput = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export async function handleGetLoginHistory(
  deps: { readOnly: ReadOnlyExecutor },
  rawInput: unknown,
  ctx: AuthContext
) {
  const input = LoginHistoryInput.parse(rawInput);

  return deps.readOnly.run(ctx, async ({ db: tx }) => {
    return getLoginHistory(tx, ctx.principalId, input.limit);
  });
}
