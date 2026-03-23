import { rosterAuditLog } from "@/src/db/schema";
import { eq, and, desc } from "drizzle-orm";
import type { TransactionClient } from "@/src/lib/tenant";

export async function appendAudit(
  tx: TransactionClient,
  userId: string,
  taskId: string,
  entry: {
    action: string;
    actor: string;
    details?: Record<string, unknown>;
    reasoning?: string;
  }
): Promise<void> {
  await tx.insert(rosterAuditLog).values({
    taskId,
    userId,
    action: entry.action,
    actor: entry.actor,
    details: entry.details ?? {},
    reasoning: entry.reasoning,
  });
}

export async function getAuditTrail(
  tx: TransactionClient,
  userId: string,
  taskId: string
): Promise<Array<typeof rosterAuditLog.$inferSelect>> {
  return tx
    .select()
    .from(rosterAuditLog)
    .where(and(eq(rosterAuditLog.taskId, taskId), eq(rosterAuditLog.userId, userId)))
    .orderBy(desc(rosterAuditLog.timestamp));
}
