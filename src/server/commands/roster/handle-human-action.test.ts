import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/src/services/rostering/roster-task-service", () => ({
  getRosterTask: vi.fn(),
  updateRosterTask: vi.fn(),
}));

vi.mock("@/src/services/rostering/audit-service", () => ({
  appendAudit: vi.fn(),
}));

vi.mock("@/src/lib/logger", () => ({
  logger: { info: vi.fn(), debug: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import { handleHumanAction, HumanActionInput } from "./handle-human-action";
import { getRosterTask, updateRosterTask } from "@/src/services/rostering/roster-task-service";
import type { UnitOfWork } from "@/src/server/uow/types";
import type { AuthContext } from "@/src/server/auth-context";

const mockCtx: AuthContext = {
  principalId: "user-1",
  supabaseId: "sub-1",
  email: "test@example.com",
  roles: ["user"],
  traceId: "trace-1",
};

function makeMockUow() {
  return {
    uow: {
      run: vi.fn(async (_ctx: unknown, fn: (txCtx: { db: unknown }) => Promise<unknown>) => {
        return fn({ db: "mock-tx" });
      }),
    } as unknown as UnitOfWork,
  };
}

const baseTask = {
  id: "task-1",
  userId: "user-1",
  status: "escalated",
  version: 1,
  contacts: [],
  llmRecommendation: { recommended_employee_id: 5, recommended_employee_name: "Alice" },
};

describe("handleHumanAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRosterTask).mockResolvedValue(baseTask as never);
    vi.mocked(updateRosterTask).mockImplementation(async (_tx, _uid, _tid, updates) => ({
      ...baseTask,
      ...updates,
      version: 2,
    }) as never);
  });

  it("should cancel task with reason", async () => {
    const deps = makeMockUow();
    const result = await handleHumanAction(deps, {
      taskId: "task-1",
      action: "cancel",
      reason: "Client cancelled",
    }, mockCtx);

    expect(updateRosterTask).toHaveBeenCalledWith(
      "mock-tx", "user-1", "task-1",
      expect.objectContaining({ status: "cancelled", escalationReason: "Client cancelled" }),
      1,
    );
    expect(result.status).toBe("cancelled");
  });

  it("should defer (no state change)", async () => {
    const deps = makeMockUow();
    const result = await handleHumanAction(deps, {
      taskId: "task-1",
      action: "defer",
    }, mockCtx);

    // Defer doesn't change status — just appends audit
    expect(updateRosterTask).not.toHaveBeenCalled();
    expect(result.status).toBe("escalated");
  });

  it("should take over task", async () => {
    const deps = makeMockUow();
    const result = await handleHumanAction(deps, {
      taskId: "task-1",
      action: "take_over",
    }, mockCtx);

    expect(updateRosterTask).toHaveBeenCalledWith(
      "mock-tx", "user-1", "task-1",
      expect.objectContaining({ status: "assigned", escalatedTo: "user-1" }),
      1,
    );
    expect(result.status).toBe("assigned");
  });

  it("should assign manually to specific employee", async () => {
    const deps = makeMockUow();
    const result = await handleHumanAction(deps, {
      taskId: "task-1",
      action: "assign_manually",
      employee_id: 42,
    }, mockCtx);

    expect(updateRosterTask).toHaveBeenCalledWith(
      "mock-tx", "user-1", "task-1",
      expect.objectContaining({ status: "accepted", assignedEmployeeId: 42 }),
      1,
    );
    expect(result.status).toBe("accepted");
  });

  it("should accept recommendation and return to contacting", async () => {
    const deps = makeMockUow();
    const result = await handleHumanAction(deps, {
      taskId: "task-1",
      action: "accept_recommendation",
    }, mockCtx);

    expect(updateRosterTask).toHaveBeenCalledWith(
      "mock-tx", "user-1", "task-1",
      expect.objectContaining({ status: "contacting" }),
      1,
    );
    expect(result.status).toBe("contacting");
  });

  it("should reject action on non-escalated task", async () => {
    vi.mocked(getRosterTask).mockResolvedValue({ ...baseTask, status: "completed" } as never);

    const deps = makeMockUow();
    await expect(
      handleHumanAction(deps, { taskId: "task-1", action: "cancel", reason: "test" }, mockCtx)
    ).rejects.toThrow();
  });
});

describe("HumanActionInput validation", () => {
  it("should require employee_id for assign_manually", () => {
    expect(() => HumanActionInput.parse({
      action: "assign_manually",
    })).toThrow();
  });

  it("should require reason for cancel", () => {
    expect(() => HumanActionInput.parse({
      action: "cancel",
    })).toThrow();
  });

  it("should accept valid cancel input", () => {
    const result = HumanActionInput.parse({ action: "cancel", reason: "No longer needed" });
    expect(result.action).toBe("cancel");
  });

  it("should accept valid defer input", () => {
    const result = HumanActionInput.parse({ action: "defer" });
    expect(result.action).toBe("defer");
  });
});
