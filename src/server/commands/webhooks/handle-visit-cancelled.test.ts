import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/src/db", () => ({
  db: { transaction: vi.fn((fn: (tx: unknown) => unknown) => fn({})) },
}));
vi.mock("@/src/services/rostering/roster-task-service", () => ({
  findActiveTasksByVisit: vi.fn(),
  updateRosterTask: vi.fn(),
}));
vi.mock("@/src/services/rostering/audit-service", () => ({
  appendAudit: vi.fn(),
}));
vi.mock("@/src/lib/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { handleVisitCancelled } from "./handle-visit-cancelled";
import { findActiveTasksByVisit, updateRosterTask } from "@/src/services/rostering/roster-task-service";
import type { AlayaCareEvent } from "@/src/lib/alayacare-events/types";

function makeEvent(payload: Record<string, unknown>): AlayaCareEvent {
  return {
    event_id: "evt-1",
    event_type: "visit.cancelled",
    timestamp: new Date().toISOString(),
    payload,
    metadata: { source: "simulation", trace_id: "t-1" },
  };
}

describe("handleVisitCancelled", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should cancel active tasks for the visit", async () => {
    const task = { id: "task-1", status: "contacting", version: 3, detectedAt: new Date() };
    vi.mocked(findActiveTasksByVisit).mockResolvedValue([task as never]);
    vi.mocked(updateRosterTask).mockResolvedValue({ ...task, status: "cancelled" } as never);

    const result = await handleVisitCancelled(makeEvent({ visit_id: 100 }), "trace-1") as Record<string, unknown>;

    expect(result.cancelled_tasks).toBe(1);
    expect(updateRosterTask).toHaveBeenCalledWith(
      expect.anything(), "system", "task-1",
      expect.objectContaining({ status: "cancelled" }),
      3
    );
  });

  it("should return 0 when no active tasks exist", async () => {
    vi.mocked(findActiveTasksByVisit).mockResolvedValue([]);

    const result = await handleVisitCancelled(makeEvent({ visit_id: 200 }), "trace-1") as Record<string, unknown>;

    expect(result.cancelled_tasks).toBe(0);
    expect(updateRosterTask).not.toHaveBeenCalled();
  });

  it("should throw on invalid visit_id", async () => {
    await expect(
      handleVisitCancelled(makeEvent({ visit_id: "abc" }), "trace-1")
    ).rejects.toThrow("visit_id must be a positive integer");
  });

  it("should continue cancelling other tasks if one fails", async () => {
    const tasks = [
      { id: "task-1", status: "contacting", version: 1, detectedAt: new Date() },
      { id: "task-2", status: "scoring", version: 2, detectedAt: new Date() },
    ];
    vi.mocked(findActiveTasksByVisit).mockResolvedValue(tasks as never);
    vi.mocked(updateRosterTask)
      .mockRejectedValueOnce(new Error("conflict"))
      .mockResolvedValueOnce({ ...tasks[1], status: "cancelled" } as never);

    const result = await handleVisitCancelled(makeEvent({ visit_id: 100 }), "trace-1") as Record<string, unknown>;

    expect(result.cancelled_tasks).toBe(1);
  });
});
