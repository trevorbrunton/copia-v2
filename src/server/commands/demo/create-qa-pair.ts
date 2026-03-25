import { z } from "zod";
import type { AuthContext } from "../../auth-context";
import type { UnitOfWork } from "../../uow/types";
import { createDemoResponse } from "@/src/services/demo-qa-service";
import { clearMatcherCache } from "@/src/demo/bedrock-matcher";

export const CreateQaPairInput = z.object({
  category: z.string().min(1).max(100),
  label: z.string().min(1).max(200),
  answerText: z.string().min(1),
  audioUrl: z.string().url().nullable().optional(),
  sortOrder: z.number().int().min(0).optional(),
  patterns: z.array(z.string().min(1)).min(1, "At least one question pattern is required"),
});

export async function handleCreateQaPair(
  deps: { uow: UnitOfWork },
  rawInput: unknown,
  ctx: AuthContext
) {
  const input = CreateQaPairInput.parse(rawInput);

  const result = await deps.uow.run(ctx, async ({ db: tx }) => {
    return createDemoResponse(tx, input);
  });
  clearMatcherCache();
  return result;
}
