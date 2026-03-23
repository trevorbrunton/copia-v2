import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/src/lib/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { executeToolCall, executeWriteToolCall, isWriteTool, TOOL_DEFINITIONS, WRITE_TOOL_DEFINITIONS } from "./chat-tools";

function makeMockTx(selectResult: unknown[] = []) {
  const select = vi.fn().mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(selectResult),
        }),
        groupBy: vi.fn().mockResolvedValue(selectResult),
        limit: vi.fn().mockResolvedValue(selectResult),
      }),
    }),
  });
  return { select } as unknown as Parameters<typeof executeToolCall>[0];
}

describe("TOOL_DEFINITIONS", () => {
  it("should have 4 tools defined", () => {
    expect(TOOL_DEFINITIONS).toHaveLength(4);
    expect(TOOL_DEFINITIONS.map((t) => t.name)).toEqual([
      "get_task_status",
      "query_metrics",
      "list_recent_tasks",
      "count_tasks_by_status",
    ]);
  });
});

describe("executeToolCall", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should return error for unknown tool", async () => {
    const tx = makeMockTx();
    const result = await executeToolCall(tx, "user-1", "nonexistent", {});
    expect(result.result).toEqual({ error: "Unknown tool: nonexistent" });
  });

  it("should execute get_task_status", async () => {
    const task = { id: "t-1", visitId: 100, status: "detected" };
    const tx = makeMockTx([task]);
    // Override to return single result
    const mockSelect = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([task]),
      }),
    });
    (tx as unknown as Record<string, unknown>).select = mockSelect;

    const result = await executeToolCall(tx, "user-1", "get_task_status", { task_id: "t-1" });
    expect(result.tool).toBe("get_task_status");
    expect((result.result as Record<string, unknown>).status).toBe("detected");
  });

  it("should return not found for missing task", async () => {
    const mockSelect = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });
    const tx = { select: mockSelect } as unknown as Parameters<typeof executeToolCall>[0];

    const result = await executeToolCall(tx, "user-1", "get_task_status", { task_id: "missing" });
    expect((result.result as Record<string, unknown>).error).toBe("Task not found");
  });

  it("should execute count_tasks_by_status", async () => {
    const counts = [
      { status: "detected", count: 3 },
      { status: "escalated", count: 2 },
    ];
    const mockSelect = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          groupBy: vi.fn().mockResolvedValue(counts),
        }),
      }),
    });
    const tx = { select: mockSelect } as unknown as Parameters<typeof executeToolCall>[0];

    const result = await executeToolCall(tx, "user-1", "count_tasks_by_status", {});
    expect(result.result).toEqual({ detected: 3, escalated: 2 });
  });
});

describe("WRITE_TOOL_DEFINITIONS", () => {
  it("should have 3 write tools defined", () => {
    expect(WRITE_TOOL_DEFINITIONS).toHaveLength(3);
    expect(WRITE_TOOL_DEFINITIONS.map((t) => t.name)).toEqual([
      "create_roster_task",
      "assign_caregiver",
      "cancel_task",
    ]);
  });
});

describe("isWriteTool", () => {
  it("should identify write tools", () => {
    expect(isWriteTool("create_roster_task")).toBe(true);
    expect(isWriteTool("assign_caregiver")).toBe(true);
    expect(isWriteTool("cancel_task")).toBe(true);
  });

  it("should not identify read tools as write tools", () => {
    expect(isWriteTool("get_task_status")).toBe(false);
    expect(isWriteTool("query_metrics")).toBe(false);
    expect(isWriteTool("nonexistent")).toBe(false);
  });
});

describe("executeWriteToolCall", () => {
  it("should reject create_roster_task with invalid visit_id", async () => {
    const tx = {} as Parameters<typeof executeWriteToolCall>[0];
    const result = await executeWriteToolCall(tx, "user-1", "create_roster_task", { visit_id: "abc" });
    expect((result.result as Record<string, unknown>).error).toContain("visit_id");
  });

  it("should reject create_roster_task with invalid urgency", async () => {
    const tx = {} as Parameters<typeof executeWriteToolCall>[0];
    const result = await executeWriteToolCall(tx, "user-1", "create_roster_task", { visit_id: 1, urgency: "invalid" });
    expect((result.result as Record<string, unknown>).error).toContain("urgency");
  });

  it("should return error for unknown write tool", async () => {
    const tx = {} as Parameters<typeof executeWriteToolCall>[0];
    const result = await executeWriteToolCall(tx, "user-1", "nonexistent_write", {});
    expect((result.result as Record<string, unknown>).error).toContain("Unknown write tool");
  });

  it("should reject assign_caregiver with missing task_id", async () => {
    const tx = {} as Parameters<typeof executeWriteToolCall>[0];
    const result = await executeWriteToolCall(tx, "user-1", "assign_caregiver", { employee_id: 1 });
    expect((result.result as Record<string, unknown>).error).toContain("task_id");
  });

  it("should reject cancel_task with missing task_id", async () => {
    const tx = {} as Parameters<typeof executeWriteToolCall>[0];
    const result = await executeWriteToolCall(tx, "user-1", "cancel_task", {});
    expect((result.result as Record<string, unknown>).error).toContain("task_id");
  });
});
