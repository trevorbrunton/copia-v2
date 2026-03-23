import { requireAuthContext } from "@/src/server/require-auth-context";
import { handleAppError } from "@/src/server/errors";
import { db } from "@/src/db";
import {
  rosterDailyMetrics,
  rosterTasks,
  workflowEvents,
} from "@/src/db/schema";
import { logger } from "@/src/lib/logger";

/**
 * Truncates rostering/webhook tables to reset the app after a mock-alaya
 * database reseed. Temporary — will be removed in a later release.
 */
export async function POST(req: Request) {
  const traceId = crypto.randomUUID();
  try {
    const ctx = await requireAuthContext(req, traceId);

    logger.info({ traceId, userId: ctx.principalId }, "Resetting rostering data");

    // Atomic delete: rosterAuditLog cascades from rosterTasks (onDelete: "cascade")
    await db.transaction(async (tx) => {
      await tx.delete(rosterDailyMetrics);
      await tx.delete(rosterTasks);
      await tx.delete(workflowEvents);
    });

    logger.info({ traceId }, "Rostering data reset complete");

    return Response.json({
      ok: true,
      tables_cleared: [
        "roster_daily_metrics",
        "roster_tasks (+ roster_audit_log via cascade)",
        "workflow_events",
      ],
    });
  } catch (err) {
    return handleAppError(err, traceId);
  }
}
