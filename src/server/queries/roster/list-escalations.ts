import type { AuthContext } from "@/src/server/auth-context";
import type { ReadOnlyExecutor } from "@/src/server/uow/types";
import { rosterTasks } from "@/src/db/schema";
import { eq, and, sql } from "drizzle-orm";
import type { RosterTask } from "@/src/db/schema";

/**
 * List escalated tasks sorted by urgency (urgent first) then detected_at (oldest first).
 */
export async function handleListEscalations(
  deps: { readOnly: ReadOnlyExecutor },
  ctx: AuthContext,
): Promise<RosterTask[]> {
  return deps.readOnly.run(ctx, async ({ db: tx }) => {
    return tx
      .select()
      .from(rosterTasks)
      .where(and(
        eq(rosterTasks.userId, ctx.principalId),
        eq(rosterTasks.status, "escalated"),
      ))
      .orderBy(
        sql`CASE WHEN ${rosterTasks.urgency} = 'urgent' THEN 0 ELSE 1 END`,
        rosterTasks.detectedAt,
      );
  });
}
