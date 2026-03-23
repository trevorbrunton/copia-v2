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

import { handleVisitUpdated } from "./handle-visit-updated";
import { findActiveTasksByVisit, updateRosterTask } from "@/src/services/rostering/roster-task-service";
import type { AlayaCareEvent } from "@/src/lib/alayacare-events/types";

function makeEvent(payload: Record<string, unknown>): AlayaCareEvent {
  return {
    event_id: "evt-1",
    event_type: "visit.updated",
    timestamp: new Date().toISOString(),
    payload,
    metadata: { source: "simulation", trace_id: "t-1" },
  };
}

describe("handleVisitUpdated", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should re-score tasks when material fields change", async () => {
    const task = { id: "task-1", status: "contacting", version: 3 };
    vi.mocked(findActiveTasksByVisit).mockResolvedValue([task as never]);
    vi.mocked(updateRosterTask).mockResolvedValue({ ...task, status: "detected" } as never);

    const result = await handleVisitUpdated(
      makeEvent({ visit_id: 100, changed_fields: ["start_at", "notes"] }),
      "trace-1"
    ) as Record<string, unknown>;

    expect(result.action).toBe("rescored");
    expect(result.rescored_tasks).toBe(1);
    expect(updateRosterTask).toHaveBeenCalledWith(
      expect.anything(), "system", "task-1",
      expect.objectContaining({ status: "detected", matchResult: null }),
      3
    );
  });

  it("should skip non-material changes", async () => {
    const result = await handleVisitUpdated(
      makeEvent({ visit_id: 100, changed_fields: ["notes", "description"] }),
      "trace-1"
    ) as Record<string, unknown>;

    expect(result.action).toBe("no_rescore_needed");
    expect(findActiveTasksByVisit).not.toHaveBeenCalled();
  });

  it("should not re-score accepted tasks", async () => {
    const tasks = [
      { id: "task-1", status: "accepted", version: 5 },
      { id: "task-2", status: "scoring", version: 2 },
    ];
    vi.mocked(findActiveTasksByVisit).mockResolvedValue(tasks as never);
    vi.mocked(updateRosterTask).mockResolvedValue({ ...tasks[1], status: "detected" } as never);

    const result = await handleVisitUpdated(
      makeEvent({ visit_id: 100, changed_fields: ["start_at"] }),
      "trace-1"
    ) as Record<string, unknown>;

    expect(result.rescored_tasks).toBe(1);
    expect(updateRosterTask).toHaveBeenCalledTimes(1);
  });

  it("should throw on invalid visit_id", async () => {
    await expect(
      handleVisitUpdated(makeEvent({ visit_id: -1 }), "trace-1")
    ).rejects.toThrow("visit_id must be a positive integer");
  });
});
