import type { AuthContext } from "../../auth-context";
import type { UnitOfWork } from "../../uow/types";
import { deleteDemoResponse } from "@/src/services/demo-qa-service";
import { NotFoundError } from "../../errors";
import { clearMatcherCache } from "@/src/demo/bedrock-matcher";

export async function handleDeleteQaPair(
  deps: { uow: UnitOfWork },
  id: string,
  ctx: AuthContext
) {
  const result = await deps.uow.run(ctx, async ({ db: tx }) => {
    const deleted = await deleteDemoResponse(tx, id);
    if (!deleted) throw new NotFoundError("QA pair");
    return { ok: true };
  });
  clearMatcherCache();
  return result;
}
