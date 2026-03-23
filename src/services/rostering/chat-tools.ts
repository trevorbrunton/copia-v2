import { rosterTasks } from "@/src/db/schema";
import { eq, and, sql, gte, desc } from "drizzle-orm";
import type { TransactionClient } from "@/src/lib/tenant";
import { appendAudit } from "./audit-service";
import { logger } from "@/src/lib/logger";

export interface ChatToolResult {
  tool: string;
  result: unknown;
}

/**
 * Rostering chat tools — read and write actions for the conversational interface.
 * Write tools return a confirmation_required flag; the chat stream route handles
 * the two-step confirmation flow (propose → confirm → execute).
 */
export const TOOL_DEFINITIONS = [
  {
    name: "get_task_status",
    description: "Get the current status and details of a roster task by ID",
    params: { task_id: "string (UUID)" },
  },
  {
    name: "query_metrics",
    description: "Query rostering metrics like fill rate, escalation count, average time to fill",
    params: { metric: "string", days: "number (default 7)" },
  },
  {
    name: "list_recent_tasks",
    description: "List recent roster tasks with optional status filter",
    params: { status: "string (optional)", limit: "number (default 10)" },
  },
  {
    name: "count_tasks_by_status",
    description: "Count roster tasks grouped by status",
    params: {},
  },
] as const;

export const WRITE_TOOL_DEFINITIONS = [
  {
    name: "create_roster_task",
    description: "Create a new roster task for a visit. Requires user confirmation before executing.",
    params: { visit_id: "number", description: "string", urgency: "string (optional: planned | urgent)" },
  },
  {
    name: "assign_caregiver",
    description: "Manually assign a caregiver to a task. Requires user confirmation before executing.",
    params: { task_id: "string (UUID)", employee_id: "number" },
  },
  {
    name: "cancel_task",
    description: "Cancel an active roster task. Requires user confirmation before executing.",
    params: { task_id: "string (UUID)", reason: "string" },
  },
] as const;

export async function executeToolCall(
  tx: TransactionClient,
  userId: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<ChatToolResult> {
  logger.info({ toolName, args }, "Executing chat tool call");

  switch (toolName) {
    case "get_task_status":
      return { tool: toolName, result: await getTaskStatus(tx, userId, String(args.task_id ?? "")) };
    case "query_metrics":
      return { tool: toolName, result: await queryMetrics(tx, userId, Number(args.days ?? 7)) };
    case "list_recent_tasks":
      return { tool: toolName, result: await listRecentTasks(tx, userId, args.status as string | undefined, Number(args.limit ?? 10)) };
    case "count_tasks_by_status":
      return { tool: toolName, result: await countTasksByStatus(tx, userId) };
    default:
      return { tool: toolName, result: { error: `Unknown tool: ${toolName}` } };
  }
}

/**
 * Execute a write tool call. Separate from read tools because write tools
 * run inside a UoW (not ReadOnly) and require prior user confirmation.
 */
export async function executeWriteToolCall(
  tx: TransactionClient,
  userId: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<ChatToolResult> {
  logger.info({ toolName, args }, "Executing chat write tool call");

  switch (toolName) {
    case "create_roster_task":
      return { tool: toolName, result: await createTaskViaCh(tx, userId, args) };
    case "assign_caregiver":
      return { tool: toolName, result: await assignCaregiverViaCh(tx, userId, args) };
    case "cancel_task":
      return { tool: toolName, result: await cancelTaskViaCh(tx, userId, args) };
    default:
      return { tool: toolName, result: { error: `Unknown write tool: ${toolName}` } };
  }
}

/** Check if a tool name is a write tool (requires confirmation). */
export function isWriteTool(toolName: string): boolean {
  return WRITE_TOOL_DEFINITIONS.some((t) => t.name === toolName);
}

async function getTaskStatus(tx: TransactionClient, userId: string, taskId: string) {
  const [task] = await tx
    .select({
      id: rosterTasks.id,
      visitId: rosterTasks.visitId,
      clientId: rosterTasks.clientId,
      status: rosterTasks.status,
      urgency: rosterTasks.urgency,
      assignedEmployeeId: rosterTasks.assignedEmployeeId,
      escalationReason: rosterTasks.escalationReason,
      detectedAt: rosterTasks.detectedAt,
      resolvedAt: rosterTasks.resolvedAt,
      timeToFillMs: rosterTasks.timeToFillMs,
    })
    .from(rosterTasks)
    .where(and(eq(rosterTasks.id, taskId), eq(rosterTasks.userId, userId)));

  if (!task) return { error: "Task not found" };
  return task;
}

async function queryMetrics(tx: TransactionClient, userId: string, days: number) {
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - Math.min(Math.max(Math.round(days), 1), 90));

  const [result] = await tx
    .select({
      total: sql<number>`count(*)::int`,
      completed: sql<number>`count(*) filter (where ${rosterTasks.status} in ('completed', 'assigned'))::int`,
      escalated: sql<number>`count(*) filter (where ${rosterTasks.status} = 'escalated')::int`,
      avgFillMs: sql<number | null>`avg(${rosterTasks.timeToFillMs})::int`,
    })
    .from(rosterTasks)
    .where(and(
      eq(rosterTasks.userId, userId),
      gte(rosterTasks.createdAt, fromDate),
    ));

  const total = result?.total ?? 0;
  const completed = result?.completed ?? 0;
  const escalated = result?.escalated ?? 0;

  return {
    period_days: days,
    total_tasks: total,
    completed,
    escalated,
    fill_rate: total > 0 ? `${Math.round((completed / total) * 100)}%` : "0%",
    escalation_rate: total > 0 ? `${Math.round((escalated / total) * 100)}%` : "0%",
    avg_time_to_fill: result?.avgFillMs != null ? `${Math.round(result.avgFillMs / 60000)} minutes` : "N/A",
  };
}

async function listRecentTasks(tx: TransactionClient, userId: string, status: string | undefined, limit: number) {
  const conditions = [eq(rosterTasks.userId, userId)];
  if (status) {
    conditions.push(eq(rosterTasks.status, status));
  }

  const tasks = await tx
    .select({
      id: rosterTasks.id,
      visitId: rosterTasks.visitId,
      status: rosterTasks.status,
      urgency: rosterTasks.urgency,
      detectedAt: rosterTasks.detectedAt,
      resolvedAt: rosterTasks.resolvedAt,
    })
    .from(rosterTasks)
    .where(and(...conditions))
    .orderBy(desc(rosterTasks.createdAt))
    .limit(Math.min(limit, 25));

  return { count: tasks.length, tasks };
}

async function countTasksByStatus(tx: TransactionClient, userId: string) {
  const counts = await tx
    .select({
      status: rosterTasks.status,
      count: sql<number>`count(*)::int`,
    })
    .from(rosterTasks)
    .where(eq(rosterTasks.userId, userId))
    .groupBy(rosterTasks.status);

  return Object.fromEntries(counts.map((c) => [c.status, c.count]));
}

// ─── Write Tool Implementations ──────────────────────────────

async function createTaskViaCh(tx: TransactionClient, userId: string, args: Record<string, unknown>) {
  const visitId = Number(args.visit_id);
  if (!Number.isFinite(visitId) || visitId <= 0) {
    return { error: "visit_id must be a positive integer" };
  }

  const urgency = String(args.urgency ?? "planned");
  if (urgency !== "planned" && urgency !== "urgent") {
    return { error: "urgency must be 'planned' or 'urgent'" };
  }

  const [task] = await tx
    .insert(rosterTasks)
    .values({
      userId,
      visitId,
      urgency,
      status: "detected",
      createdBy: "chat",
    })
    .returning({ id: rosterTasks.id, visitId: rosterTasks.visitId, status: rosterTasks.status });

  await appendAudit(tx, userId, task.id, {
    action: "task_created_via_chat",
    actor: userId,
    details: { visit_id: visitId, urgency },
  });

  return { created: true, task_id: task.id, visit_id: task.visitId, status: task.status };
}

async function assignCaregiverViaCh(tx: TransactionClient, userId: string, args: Record<string, unknown>) {
  const taskId = String(args.task_id ?? "");
  const employeeId = Number(args.employee_id);

  if (!taskId) return { error: "task_id is required" };
  if (!Number.isFinite(employeeId) || employeeId <= 0) {
    return { error: "employee_id must be a positive integer" };
  }

  const [task] = await tx
    .select({ id: rosterTasks.id, status: rosterTasks.status, version: rosterTasks.version })
    .from(rosterTasks)
    .where(and(eq(rosterTasks.id, taskId), eq(rosterTasks.userId, userId)));

  if (!task) return { error: "Task not found" };

  const ASSIGNABLE = new Set(["detected", "gathering", "scoring", "reasoning", "contacting", "cascading", "accepted"]);
  if (!ASSIGNABLE.has(task.status)) {
    return { error: `Cannot assign — task is in '${task.status}' status` };
  }

  const [updated] = await tx
    .update(rosterTasks)
    .set({
      assignedEmployeeId: employeeId,
      status: "assigned",
      resolvedAt: new Date(),
      version: task.version + 1,
      updatedAt: new Date(),
    })
    .where(and(eq(rosterTasks.id, taskId), eq(rosterTasks.version, task.version)))
    .returning({ id: rosterTasks.id, status: rosterTasks.status, assignedEmployeeId: rosterTasks.assignedEmployeeId });

  if (!updated) return { error: "Task was modified concurrently — retry" };

  await appendAudit(tx, userId, taskId, {
    action: "caregiver_assigned_via_chat",
    actor: userId,
    details: { employee_id: employeeId, previous_status: task.status },
  });

  return { assigned: true, task_id: updated.id, employee_id: updated.assignedEmployeeId };
}

async function cancelTaskViaCh(tx: TransactionClient, userId: string, args: Record<string, unknown>) {
  const taskId = String(args.task_id ?? "");
  const reason = String(args.reason ?? "Cancelled via chat");

  if (!taskId) return { error: "task_id is required" };

  const [task] = await tx
    .select({ id: rosterTasks.id, status: rosterTasks.status, version: rosterTasks.version })
    .from(rosterTasks)
    .where(and(eq(rosterTasks.id, taskId), eq(rosterTasks.userId, userId)));

  if (!task) return { error: "Task not found" };

  const TERMINAL = new Set(["assigned", "completed", "cancelled"]);
  if (TERMINAL.has(task.status)) {
    return { error: `Cannot cancel — task is already in '${task.status}' status` };
  }

  const [updated] = await tx
    .update(rosterTasks)
    .set({
      status: "cancelled",
      escalationReason: reason,
      resolvedAt: new Date(),
      version: task.version + 1,
      updatedAt: new Date(),
    })
    .where(and(eq(rosterTasks.id, taskId), eq(rosterTasks.version, task.version)))
    .returning({ id: rosterTasks.id, status: rosterTasks.status });

  if (!updated) return { error: "Task was modified concurrently — retry" };

  await appendAudit(tx, userId, taskId, {
    action: "task_cancelled_via_chat",
    actor: userId,
    details: { reason, previous_status: task.status },
  });

  return { cancelled: true, task_id: updated.id, reason };
}
