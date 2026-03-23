import type { AuthContext } from "@/src/server/auth-context";
import type { ReadOnlyExecutor } from "@/src/server/uow/types";
import { z } from "zod";
import { rosterAuditLog } from "@/src/db/schema";
import { eq, and, desc, gte, lte, sql } from "drizzle-orm";

export const AuditSearchInput = z.object({
  task_id: z.string().uuid().optional(),
  action: z.string().optional(),
  actor: z.string().optional(),
  from_date: z.string().optional(),
  to_date: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type AuditSearchInputType = z.infer<typeof AuditSearchInput>;

export async function handleSearchAuditLog(
  deps: { readOnly: ReadOnlyExecutor },
  rawInput: unknown,
  ctx: AuthContext,
) {
  const input = AuditSearchInput.parse(rawInput);

  return deps.readOnly.run(ctx, async ({ db: tx }) => {
    const conditions = [eq(rosterAuditLog.userId, ctx.principalId)];

    if (input.task_id) {
      conditions.push(eq(rosterAuditLog.taskId, input.task_id));
    }
    if (input.action) {
      conditions.push(eq(rosterAuditLog.action, input.action));
    }
    if (input.actor) {
      conditions.push(eq(rosterAuditLog.actor, input.actor));
    }
    if (input.from_date) {
      conditions.push(gte(rosterAuditLog.timestamp, new Date(input.from_date)));
    }
    if (input.to_date) {
      conditions.push(lte(rosterAuditLog.timestamp, new Date(input.to_date)));
    }

    const [countResult] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(rosterAuditLog)
      .where(and(...conditions));

    const rows = await tx
      .select()
      .from(rosterAuditLog)
      .where(and(...conditions))
      .orderBy(desc(rosterAuditLog.timestamp))
      .limit(input.limit)
      .offset(input.offset);

    return {
      items: rows,
      total: countResult?.count ?? 0,
      limit: input.limit,
      offset: input.offset,
    };
  });
}
