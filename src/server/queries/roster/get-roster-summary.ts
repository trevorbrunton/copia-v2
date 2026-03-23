import type { AuthContext } from "@/src/server/auth-context";
import type { ReadOnlyExecutor } from "@/src/server/uow/types";
import { rosterTasks } from "@/src/db/schema";
import { eq, and, sql, inArray } from "drizzle-orm";

export interface RosterSummary {
  active: number;
  escalated: number;
  completedToday: number;
  avgTimeToFillMs: number | null;
}

const ACTIVE_STATUSES = [
  "detected", "gathering", "scoring", "reasoning",
  "contacting", "cascading", "accepted",
];

export async function handleGetRosterSummary(
  deps: { readOnly: ReadOnlyExecutor },
  ctx: AuthContext,
): Promise<RosterSummary> {
  return deps.readOnly.run(ctx, async ({ db: tx }) => {
    const userId = ctx.principalId;

    // Active tasks count
    const [activeResult] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(rosterTasks)
      .where(and(
        eq(rosterTasks.userId, userId),
        inArray(rosterTasks.status, ACTIVE_STATUSES),
      ));

    // Escalated count
    const [escalatedResult] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(rosterTasks)
      .where(and(
        eq(rosterTasks.userId, userId),
        eq(rosterTasks.status, "escalated"),
      ));

    // Completed today (using database timezone for consistency)
    const [completedTodayResult] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(rosterTasks)
      .where(and(
        eq(rosterTasks.userId, userId),
        inArray(rosterTasks.status, ["completed", "assigned"]),
        sql`${rosterTasks.resolvedAt}::date = CURRENT_DATE`,
      ));

    // Average time to fill
    const [avgResult] = await tx
      .select({ avg: sql<number | null>`avg(${rosterTasks.timeToFillMs})::int` })
      .from(rosterTasks)
      .where(and(
        eq(rosterTasks.userId, userId),
        sql`${rosterTasks.timeToFillMs} IS NOT NULL`,
      ));

    return {
      active: activeResult?.count ?? 0,
      escalated: escalatedResult?.count ?? 0,
      completedToday: completedTodayResult?.count ?? 0,
      avgTimeToFillMs: avgResult?.avg ?? null,
    };
  });
}
