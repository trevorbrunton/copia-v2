import type { AuthContext } from "../../auth-context";
import type { ReadOnlyExecutor } from "../../uow/types";
import { listDemoResponses } from "@/src/services/demo-qa-service";

export async function handleListQaPairs(
  deps: { readOnly: ReadOnlyExecutor },
  ctx: AuthContext
) {
  return deps.readOnly.run(ctx, async ({ db: tx }) => {
    return listDemoResponses(tx);
  });
}
