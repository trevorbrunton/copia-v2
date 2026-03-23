import { rosterTasks, rosterDailyMetrics } from "@/src/db/schema";
import { eq, and, sql, inArray } from "drizzle-orm";
import type { TransactionClient } from "@/src/lib/tenant";
import { logger } from "@/src/lib/logger";

/**
 * Materialise daily metrics for a given date.
 * Aggregates from completed roster_tasks into roster_daily_metrics.
 * Idempotent: upserts on (user_id, date) unique constraint.
 */
export async function materialiseDailyMetrics(
  tx: TransactionClient,
  userId: string,
  date: string,
): Promise<void> {
  // Count tasks created on this date
  const [createdResult] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(rosterTasks)
    .where(and(
      eq(rosterTasks.userId, userId),
      sql`${rosterTasks.createdAt}::date = ${date}`,
    ));

  // Count tasks filled autonomously (completed/assigned, no escalation)
  const [autonomousResult] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(rosterTasks)
    .where(and(
      eq(rosterTasks.userId, userId),
      sql`${rosterTasks.resolvedAt}::date = ${date}`,
      inArray(rosterTasks.status, ["completed", "assigned"]),
      sql`${rosterTasks.escalatedTo} IS NULL`,
    ));

  // Count escalated tasks
  const [escalatedResult] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(rosterTasks)
    .where(and(
      eq(rosterTasks.userId, userId),
      sql`${rosterTasks.resolvedAt}::date = ${date}`,
      eq(rosterTasks.status, "escalated"),
    ));

  // Average time to fill
  const [avgResult] = await tx
    .select({ avg: sql<number | null>`avg(${rosterTasks.timeToFillMs})::int` })
    .from(rosterTasks)
    .where(and(
      eq(rosterTasks.userId, userId),
      sql`${rosterTasks.resolvedAt}::date = ${date}`,
      sql`${rosterTasks.timeToFillMs} IS NOT NULL`,
    ));

  // First-contact acceptance rate: tasks where first contact accepted / total resolved
  const [resolvedResult] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(rosterTasks)
    .where(and(
      eq(rosterTasks.userId, userId),
      sql`${rosterTasks.resolvedAt}::date = ${date}`,
      inArray(rosterTasks.status, ["completed", "assigned"]),
    ));

  const [firstAcceptResult] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(rosterTasks)
    .where(and(
      eq(rosterTasks.userId, userId),
      sql`${rosterTasks.resolvedAt}::date = ${date}`,
      inArray(rosterTasks.status, ["completed", "assigned"]),
      sql`${rosterTasks.currentContactIndex} = 0`,
    ));

  const resolved = resolvedResult?.count ?? 0;
  const firstAccept = firstAcceptResult?.count ?? 0;
  const acceptanceRate = resolved > 0
    ? Math.round((firstAccept / resolved) * 10000) / 100 // Two decimal places
    : null;

  // Upsert into daily metrics
  await tx
    .insert(rosterDailyMetrics)
    .values({
      userId,
      date,
      tasksCreated: createdResult?.count ?? 0,
      tasksFilledAutonomous: autonomousResult?.count ?? 0,
      tasksEscalated: escalatedResult?.count ?? 0,
      avgTimeToFillMs: avgResult?.avg ?? null,
      firstContactAcceptanceRate: acceptanceRate?.toString() ?? null,
    })
    .onConflictDoUpdate({
      target: [rosterDailyMetrics.userId, rosterDailyMetrics.date],
      set: {
        tasksCreated: createdResult?.count ?? 0,
        tasksFilledAutonomous: autonomousResult?.count ?? 0,
        tasksEscalated: escalatedResult?.count ?? 0,
        avgTimeToFillMs: avgResult?.avg ?? null,
        firstContactAcceptanceRate: acceptanceRate?.toString() ?? null,
      },
    });

  logger.info(
    { userId, date, created: createdResult?.count, autonomous: autonomousResult?.count, escalated: escalatedResult?.count },
    "Daily metrics materialised"
  );
}
