import { z } from "zod";
import type { AuthContext } from "../../auth-context";
import type { UnitOfWork } from "../../uow/types";
import { updateDemoResponse } from "@/src/services/demo-qa-service";
import { NotFoundError } from "../../errors";
import { clearMatcherCache } from "@/src/demo/bedrock-matcher";

export const UpdateQaPairInput = z.object({
  category: z.string().min(1).max(100).optional(),
  label: z.string().min(1).max(200).optional(),
  answerText: z.string().min(1).optional(),
  audioUrl: z.string().url().nullable().optional(),
  sortOrder: z.number().int().min(0).optional(),
  patterns: z.array(z.string().min(1)).min(1).optional(),
});

export async function handleUpdateQaPair(
  deps: { uow: UnitOfWork },
  id: string,
  rawInput: unknown,
  ctx: AuthContext
) {
  const input = UpdateQaPairInput.parse(rawInput);

  const result = await deps.uow.run(ctx, async ({ db: tx }) => {
    const updated = await updateDemoResponse(tx, id, input);
    if (!updated) throw new NotFoundError("QA pair");
    return updated;
  });
  clearMatcherCache();
  return result;
}
