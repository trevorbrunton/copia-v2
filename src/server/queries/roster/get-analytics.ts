import type { AuthContext } from "@/src/server/auth-context";
import type { ReadOnlyExecutor } from "@/src/server/uow/types";
import { z } from "zod";
import { rosterTasks, rosterDailyMetrics } from "@/src/db/schema";
import { eq, and, sql, gte, lte, desc, inArray } from "drizzle-orm";

export const AnalyticsInput = z.object({
  days: z.coerce.number().int().min(1).max(90).default(30),
});

export interface AnalyticsResult {
  period: { days: number; from: string; to: string };
  totals: {
    tasks_created: number;
    tasks_filled_autonomous: number;
    tasks_escalated: number;
    tasks_completed: number;
  };
  rates: {
    autonomous_fill_rate: number;
    escalation_rate: number;
    first_contact_acceptance_rate: number | null;
  };
  timing: {
    avg_time_to_fill_ms: number | null;
  };
  daily: Array<{
    date: string;
    tasks_created: number;
    tasks_filled_autonomous: number;
    tasks_escalated: number;
    avg_time_to_fill_ms: number | null;
  }>;
}

export async function handleGetAnalytics(
  deps: { readOnly: ReadOnlyExecutor },
  rawInput: unknown,
  ctx: AuthContext,
): Promise<AnalyticsResult> {
  const { days } = AnalyticsInput.parse(rawInput);

  return deps.readOnly.run(ctx, async ({ db: tx }) => {
    const userId = ctx.principalId;
    const now = new Date();
    const from = new Date(now);
    from.setDate(from.getDate() - days);
    const fromStr = from.toISOString().split("T")[0];
    const toStr = now.toISOString().split("T")[0];

    // Try materialised daily metrics first
    const dailyMetrics = await tx
      .select()
      .from(rosterDailyMetrics)
      .where(and(
        eq(rosterDailyMetrics.userId, userId),
        gte(rosterDailyMetrics.date, fromStr),
        lte(rosterDailyMetrics.date, toStr),
      ))
      .orderBy(desc(rosterDailyMetrics.date));

    // If we have materialised data, use it
    if (dailyMetrics.length > 0) {
      const totals = dailyMetrics.reduce(
        (acc, m) => ({
          tasks_created: acc.tasks_created + m.tasksCreated,
          tasks_filled_autonomous: acc.tasks_filled_autonomous + m.tasksFilledAutonomous,
          tasks_escalated: acc.tasks_escalated + m.tasksEscalated,
          tasks_completed: acc.tasks_completed + m.tasksFilledAutonomous + m.tasksEscalated,
        }),
        { tasks_created: 0, tasks_filled_autonomous: 0, tasks_escalated: 0, tasks_completed: 0 }
      );

      const avgTimes = dailyMetrics
        .filter((m) => m.avgTimeToFillMs != null)
        .map((m) => m.avgTimeToFillMs!);

      const avgAccRates = dailyMetrics
        .filter((m) => m.firstContactAcceptanceRate != null)
        .map((m) => Number(m.firstContactAcceptanceRate));

      return {
        period: { days, from: fromStr, to: toStr },
        totals,
        rates: {
          autonomous_fill_rate: totals.tasks_created > 0
            ? totals.tasks_filled_autonomous / totals.tasks_created
            : 0,
          escalation_rate: totals.tasks_created > 0
            ? totals.tasks_escalated / totals.tasks_created
            : 0,
          first_contact_acceptance_rate: avgAccRates.length > 0
            ? avgAccRates.reduce((a, b) => a + b, 0) / avgAccRates.length
            : null,
        },
        timing: {
          avg_time_to_fill_ms: avgTimes.length > 0
            ? Math.round(avgTimes.reduce((a, b) => a + b, 0) / avgTimes.length)
            : null,
        },
        daily: dailyMetrics.map((m) => ({
          date: m.date,
          tasks_created: m.tasksCreated,
          tasks_filled_autonomous: m.tasksFilledAutonomous,
          tasks_escalated: m.tasksEscalated,
          avg_time_to_fill_ms: m.avgTimeToFillMs,
        })),
      };
    }

    // Fallback: compute from raw roster_tasks
    const fromDate = new Date(fromStr);

    const [totalsResult] = await tx
      .select({
        total: sql<number>`count(*)::int`,
        completed: sql<number>`count(*) filter (where ${rosterTasks.status} in ('completed', 'assigned'))::int`,
        escalated: sql<number>`count(*) filter (where ${rosterTasks.status} = 'escalated')::int`,
        avgFill: sql<number | null>`avg(${rosterTasks.timeToFillMs})::int`,
      })
      .from(rosterTasks)
      .where(and(
        eq(rosterTasks.userId, userId),
        gte(rosterTasks.createdAt, fromDate),
      ));

    // Autonomous = completed without escalation
    const [autonomousResult] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(rosterTasks)
      .where(and(
        eq(rosterTasks.userId, userId),
        gte(rosterTasks.createdAt, fromDate),
        inArray(rosterTasks.status, ["completed", "assigned"]),
        sql`${rosterTasks.escalatedTo} IS NULL`,
      ));

    const total = totalsResult?.total ?? 0;
    const completed = totalsResult?.completed ?? 0;
    const escalated = totalsResult?.escalated ?? 0;
    const autonomous = autonomousResult?.count ?? 0;

    return {
      period: { days, from: fromStr, to: toStr },
      totals: {
        tasks_created: total,
        tasks_filled_autonomous: autonomous,
        tasks_escalated: escalated,
        tasks_completed: completed,
      },
      rates: {
        autonomous_fill_rate: total > 0 ? autonomous / total : 0,
        escalation_rate: total > 0 ? escalated / total : 0,
        first_contact_acceptance_rate: null, // Requires materialised metrics
      },
      timing: {
        avg_time_to_fill_ms: totalsResult?.avgFill ?? null,
      },
      daily: [], // No daily breakdown without materialised metrics
    };
  });
}
