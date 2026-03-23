import { rosterTasks } from "@/src/db/schema";
import { eq, and, desc, inArray, sql } from "drizzle-orm";
import { ConflictError, NotFoundError } from "@/src/server/errors";
import type { TransactionClient } from "@/src/lib/tenant";
import type { CreateRosterTaskInputType, RosterTaskStatusFilterType, RosterTaskStatus } from "./types";

type RosterTask = typeof rosterTasks.$inferSelect;

export async function createRosterTask(
  tx: TransactionClient,
  userId: string,
  input: CreateRosterTaskInputType & {
    sourceEventId?: string;
    matchResult?: unknown;
    llmRecommendation?: unknown;
    status?: RosterTaskStatus;
  }
): Promise<RosterTask> {
  const [task] = await tx
    .insert(rosterTasks)
    .values({
      userId,
      visitId: input.visit_id,
      clientId: input.client_id,
      urgency: input.urgency ?? "planned",
      sourceEventId: input.sourceEventId,
      matchResult: input.matchResult,
      llmRecommendation: input.llmRecommendation,
      status: input.status ?? "detected",
    })
    .returning();
  if (!task) throw new Error("Failed to create roster task");
  return task;
}

export async function getRosterTask(
  tx: TransactionClient,
  userId: string,
  taskId: string
): Promise<RosterTask> {
  const [task] = await tx
    .select()
    .from(rosterTasks)
    .where(and(eq(rosterTasks.id, taskId), eq(rosterTasks.userId, userId)));
  if (!task) throw new NotFoundError("RosterTask");
  return task;
}

export async function listRosterTasks(
  tx: TransactionClient,
  userId: string,
  filter: RosterTaskStatusFilterType
): Promise<RosterTask[]> {
  const conditions = [eq(rosterTasks.userId, userId)];
  if (filter.status) {
    conditions.push(eq(rosterTasks.status, filter.status));
  }
  return tx
    .select()
    .from(rosterTasks)
    .where(and(...conditions))
    .orderBy(desc(rosterTasks.detectedAt))
    .limit(filter.limit)
    .offset(filter.offset);
}

export async function updateRosterTask(
  tx: TransactionClient,
  userId: string,
  taskId: string,
  updates: Partial<typeof rosterTasks.$inferInsert>,
  expectedVersion: number
): Promise<RosterTask> {
  const [updated] = await tx
    .update(rosterTasks)
    .set({
      ...updates,
      version: expectedVersion + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(rosterTasks.id, taskId),
        eq(rosterTasks.userId, userId),
        eq(rosterTasks.version, expectedVersion)
      )
    )
    .returning();
  if (!updated)
    throw new ConflictError("Task was modified concurrently — retry");
  return updated;
}

const ACTIVE_STATUSES: RosterTaskStatus[] = [
  "detected", "gathering", "scoring", "reasoning",
  "contacting", "cascading", "accepted",
];

export async function findActiveTasksByVisit(
  tx: TransactionClient,
  userId: string,
  visitId: number
): Promise<RosterTask[]> {
  return tx
    .select()
    .from(rosterTasks)
    .where(and(
      eq(rosterTasks.userId, userId),
      eq(rosterTasks.visitId, visitId),
      inArray(rosterTasks.status, ACTIVE_STATUSES),
    ));
}

export async function findActiveTasksByEmployeeContact(
  tx: TransactionClient,
  userId: string,
  employeeId: number
): Promise<RosterTask[]> {
  return tx
    .select()
    .from(rosterTasks)
    .where(and(
      eq(rosterTasks.userId, userId),
      inArray(rosterTasks.status, ACTIVE_STATUSES),
      sql`${rosterTasks.contacts} @> cast(${JSON.stringify([{ employee_id: employeeId }])} as jsonb)`,
    ));
}
