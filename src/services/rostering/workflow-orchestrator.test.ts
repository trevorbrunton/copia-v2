import { describe, it, expect, vi, beforeEach } from "vitest";
import { advanceTask } from "./workflow-orchestrator";
import type { AuthContext } from "@/src/server/auth-context";
import type { UnitOfWork, TransactionContext } from "@/src/server/uow/types";
import type { RosterTask } from "@/src/db/schema";

// Mock the service dependencies
vi.mock("./roster-task-service", () => ({
  getRosterTask: vi.fn(),
  updateRosterTask: vi.fn(),
}));

vi.mock("./audit-service", () => ({
  appendAudit: vi.fn(),
}));

vi.mock("@/src/lib/logger", () => ({
  logger: { info: vi.fn(), debug: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

vi.mock("@/src/lib/alayacare-client", () => ({
  alayaFetch: vi.fn(),
}));

vi.mock("@/src/services/reasoning/reasoning-service", () => ({
  getRecommendation: vi.fn(),
}));

vi.mock("@/src/services/recommendation-context", () => ({
  buildRecommendationContext: vi.fn(),
}));

import { getRosterTask, updateRosterTask } from "./roster-task-service";
import { appendAudit } from "./audit-service";
import { alayaFetch } from "@/src/lib/alayacare-client";
import { getRecommendation } from "@/src/services/reasoning/reasoning-service";
import { buildRecommendationContext } from "@/src/services/recommendation-context";

const mockCtx: AuthContext = {
  principalId: "user-123",
  supabaseId: "sub-123",
  email: "test@example.com",
  roles: ["user"],
  traceId: "trace-123",
};

function makeTask(overrides: Partial<RosterTask> = {}): RosterTask {
  return {
    id: "task-abc",
    userId: "user-123",
    visitId: 100,
    clientId: 10,
    status: "detected",
    urgency: "planned",
    version: 1,
    matchResult: null,
    llmRecommendation: null,
    contacts: [],
    currentContactIndex: 0,
    cascadeStrategy: "sequential",
    assignedEmployeeId: null,
    escalatedTo: null,
    escalationReason: null,
    sourceEventId: null,
    detectedAt: new Date(),
    scoringCompletedAt: null,
    firstContactAt: null,
    resolvedAt: null,
    timeToFillMs: null,
    createdBy: "system",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeMockUoW(): UnitOfWork {
  const run = vi.fn(async (_ctx: AuthContext, fn: (tx: TransactionContext) => Promise<unknown>) => {
    return fn({ db: {} as never });
  });
  return { run } as unknown as UnitOfWork;
}

describe("advanceTask", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should advance from detected to gathering", async () => {
    const task = makeTask({ status: "detected" });
    const updatedTask = makeTask({ status: "gathering", version: 2 });

    vi.mocked(getRosterTask).mockResolvedValue(task);
    vi.mocked(updateRosterTask).mockResolvedValue(updatedTask);
    vi.mocked(appendAudit).mockResolvedValue(undefined);

    const uow = makeMockUoW();
    const result = await advanceTask({ uow }, mockCtx, "task-abc");

    expect(result.status).toBe("gathering");
    expect(updateRosterTask).toHaveBeenCalledWith(
      expect.anything(),
      "user-123",
      "task-abc",
      expect.objectContaining({ status: "gathering" }),
      1
    );
    expect(appendAudit).toHaveBeenCalledWith(
      expect.anything(),
      "user-123",
      "task-abc",
      expect.objectContaining({ action: "detected_to_gathering" })
    );
  });

  it("should advance from gathering to scoring", async () => {
    const task = makeTask({ status: "gathering", version: 2 });
    const updatedTask = makeTask({ status: "scoring", version: 3 });

    vi.mocked(getRosterTask).mockResolvedValue(task);
    vi.mocked(updateRosterTask).mockResolvedValue(updatedTask);
    vi.mocked(appendAudit).mockResolvedValue(undefined);

    const result = await advanceTask({ uow: makeMockUoW() }, mockCtx, "task-abc");
    expect(result.status).toBe("scoring");
  });

  it("should advance from scoring to reasoning", async () => {
    const task = makeTask({ status: "scoring", version: 3 });
    const updatedTask = makeTask({ status: "reasoning", version: 4 });

    vi.mocked(getRosterTask).mockResolvedValue(task);
    vi.mocked(updateRosterTask).mockResolvedValue(updatedTask);
    vi.mocked(appendAudit).mockResolvedValue(undefined);

    const result = await advanceTask({ uow: makeMockUoW() }, mockCtx, "task-abc");
    expect(result.status).toBe("reasoning");
  });

  it("should advance from reasoning to completed in dry-run mode", async () => {
    const task = makeTask({ status: "reasoning", version: 4 });
    const updatedTask = makeTask({ status: "completed", version: 5 });

    vi.mocked(getRosterTask).mockResolvedValue(task);
    vi.mocked(updateRosterTask).mockResolvedValue(updatedTask);
    vi.mocked(appendAudit).mockResolvedValue(undefined);

    const result = await advanceTask({ uow: makeMockUoW() }, mockCtx, "task-abc");
    expect(result.status).toBe("completed");
  });

  it("should not advance a terminal state (completed)", async () => {
    const task = makeTask({ status: "completed", version: 5 });

    vi.mocked(getRosterTask).mockResolvedValue(task);

    const result = await advanceTask({ uow: makeMockUoW() }, mockCtx, "task-abc");
    expect(result.status).toBe("completed");
    expect(updateRosterTask).not.toHaveBeenCalled();
  });

  it("should not advance a terminal state (escalated)", async () => {
    const task = makeTask({ status: "escalated", version: 3 });

    vi.mocked(getRosterTask).mockResolvedValue(task);

    const result = await advanceTask({ uow: makeMockUoW() }, mockCtx, "task-abc");
    expect(result.status).toBe("escalated");
    expect(updateRosterTask).not.toHaveBeenCalled();
  });

  it("should not advance a terminal state (cancelled)", async () => {
    const task = makeTask({ status: "cancelled", version: 2 });

    vi.mocked(getRosterTask).mockResolvedValue(task);

    const result = await advanceTask({ uow: makeMockUoW() }, mockCtx, "task-abc");
    expect(result.status).toBe("cancelled");
    expect(updateRosterTask).not.toHaveBeenCalled();
  });

  it("should call UoW.run with correct AuthContext", async () => {
    const task = makeTask({ status: "detected" });
    const updatedTask = makeTask({ status: "gathering", version: 2 });

    vi.mocked(getRosterTask).mockResolvedValue(task);
    vi.mocked(updateRosterTask).mockResolvedValue(updatedTask);
    vi.mocked(appendAudit).mockResolvedValue(undefined);

    const uow = makeMockUoW();
    await advanceTask({ uow }, mockCtx, "task-abc");

    // UoW.run should be called twice (read + persist)
    expect(uow.run).toHaveBeenCalledTimes(2);
    expect(uow.run).toHaveBeenCalledWith(mockCtx, expect.any(Function));
  });

  describe("accepted → AlayaCare write-back", () => {
    it("should complete task on successful write-back", async () => {
      const task = makeTask({
        status: "accepted",
        assignedEmployeeId: 42,
        visitId: 200,
        version: 5,
      });
      const completedTask = makeTask({ status: "completed", version: 6 });

      vi.mocked(getRosterTask).mockResolvedValue(task);
      vi.mocked(updateRosterTask).mockResolvedValue(completedTask);
      vi.mocked(appendAudit).mockResolvedValue(undefined);
      vi.mocked(alayaFetch).mockResolvedValue({});

      const result = await advanceTask({ uow: makeMockUoW() }, mockCtx, "task-abc");

      expect(result.status).toBe("completed");
      expect(alayaFetch).toHaveBeenCalledWith(
        "/scheduler/visits/200/offers",
        { method: "POST", body: { employee_id: 42 } }
      );
      expect(updateRosterTask).toHaveBeenCalledWith(
        expect.anything(),
        "user-123",
        "task-abc",
        expect.objectContaining({ status: "completed", resolvedAt: expect.any(Date) }),
        5
      );
    });

    it("should fall back to assigned on write-back failure", async () => {
      const task = makeTask({
        status: "accepted",
        assignedEmployeeId: 42,
        visitId: 200,
        version: 5,
      });
      const assignedTask = makeTask({ status: "assigned", version: 6 });

      vi.mocked(getRosterTask).mockResolvedValue(task);
      vi.mocked(updateRosterTask).mockResolvedValue(assignedTask);
      vi.mocked(appendAudit).mockResolvedValue(undefined);
      vi.mocked(alayaFetch).mockRejectedValue(new Error("AlayaCare API error: 500"));

      const result = await advanceTask({ uow: makeMockUoW() }, mockCtx, "task-abc");

      expect(result.status).toBe("assigned");
      expect(updateRosterTask).toHaveBeenCalledWith(
        expect.anything(),
        "user-123",
        "task-abc",
        expect.objectContaining({
          status: "assigned",
          escalationReason: expect.stringContaining("write-back failed"),
        }),
        5
      );
    });

    it("should escalate when no employeeId on accepted task", async () => {
      const task = makeTask({
        status: "accepted",
        assignedEmployeeId: null,
        version: 5,
      });
      const escalatedTask = makeTask({ status: "escalated", version: 6 });

      vi.mocked(getRosterTask).mockResolvedValue(task);
      vi.mocked(updateRosterTask).mockResolvedValue(escalatedTask);
      vi.mocked(appendAudit).mockResolvedValue(undefined);

      const result = await advanceTask({ uow: makeMockUoW() }, mockCtx, "task-abc");

      expect(result.status).toBe("escalated");
      expect(alayaFetch).not.toHaveBeenCalled();
    });
  });

  describe("P1.5.5 auto-escalation triggers", () => {
    it("should escalate when fewer than 3 candidates (thin bench)", async () => {
      const task = makeTask({
        status: "scoring",
        matchResult: {
          candidates: [
            { employee_id: 1, employee_name: "A", overall_score: 80 },
            { employee_id: 2, employee_name: "B", overall_score: 70 },
          ],
        },
        version: 3,
      });
      const escalatedTask = makeTask({ status: "escalated", version: 4 });

      vi.mocked(getRosterTask).mockResolvedValue(task);
      vi.mocked(updateRosterTask).mockResolvedValue(escalatedTask);
      vi.mocked(appendAudit).mockResolvedValue(undefined);

      const result = await advanceTask({ uow: makeMockUoW() }, mockCtx, "task-abc");

      expect(result.status).toBe("escalated");
      expect(updateRosterTask).toHaveBeenCalledWith(
        expect.anything(),
        "user-123",
        "task-abc",
        expect.objectContaining({
          status: "escalated",
          escalationReason: expect.stringContaining("thin bench"),
        }),
        3
      );
    });

    it("should escalate when no candidates at all", async () => {
      const task = makeTask({
        status: "scoring",
        matchResult: { candidates: [] },
        version: 3,
      });
      const escalatedTask = makeTask({ status: "escalated", version: 4 });

      vi.mocked(getRosterTask).mockResolvedValue(task);
      vi.mocked(updateRosterTask).mockResolvedValue(escalatedTask);
      vi.mocked(appendAudit).mockResolvedValue(undefined);

      const result = await advanceTask({ uow: makeMockUoW() }, mockCtx, "task-abc");

      expect(result.status).toBe("escalated");
      expect(updateRosterTask).toHaveBeenCalledWith(
        expect.anything(),
        "user-123",
        "task-abc",
        expect.objectContaining({
          escalationReason: expect.stringContaining("No match result"),
        }),
        3
      );
    });

    it("should escalate when LLM confidence is low", async () => {
      const lowConfidenceRec = {
        primary: { employee_id: 1, employee_name: "A", explanation: "...", confidence: "low" },
        escalation: { should_escalate: false, reason: null, urgency: "informational" },
        factors_considered: [],
        trade_offs: [],
        model: "test",
        usage: { inputTokens: 0, outputTokens: 0 },
      };

      const task = makeTask({
        status: "reasoning",
        llmRecommendation: lowConfidenceRec,
        version: 4,
      });
      const escalatedTask = makeTask({ status: "escalated", version: 5 });

      vi.mocked(getRosterTask).mockResolvedValue(task);
      vi.mocked(updateRosterTask).mockResolvedValue(escalatedTask);
      vi.mocked(appendAudit).mockResolvedValue(undefined);

      const result = await advanceTask({ uow: makeMockUoW() }, mockCtx, "task-abc");

      expect(result.status).toBe("escalated");
      expect(updateRosterTask).toHaveBeenCalledWith(
        expect.anything(),
        "user-123",
        "task-abc",
        expect.objectContaining({
          escalationReason: expect.stringContaining("low"),
        }),
        4
      );
    });

    it("should proceed to contacting when confidence is medium or high", async () => {
      const medConfidenceRec = {
        primary: { employee_id: 1, employee_name: "A", explanation: "...", confidence: "medium" },
        escalation: { should_escalate: false, reason: null, urgency: "informational" },
        factors_considered: [],
        trade_offs: [],
        model: "test",
        usage: { inputTokens: 0, outputTokens: 0 },
      };

      const task = makeTask({
        status: "reasoning",
        llmRecommendation: medConfidenceRec,
        version: 4,
      });
      const contactingTask = makeTask({ status: "contacting", version: 5 });

      vi.mocked(getRosterTask).mockResolvedValue(task);
      vi.mocked(updateRosterTask).mockResolvedValue(contactingTask);
      vi.mocked(appendAudit).mockResolvedValue(undefined);

      const result = await advanceTask({ uow: makeMockUoW() }, mockCtx, "task-abc");

      expect(result.status).toBe("contacting");
    });
  });
});
