import { describe, it, expect, vi, beforeEach } from "vitest";
import { advanceTask } from "./workflow-orchestrator";
import type { AuthContext } from "@/src/server/auth-context";
import type { UnitOfWork, TransactionContext } from "@/src/server/uow/types";
import type { RosterTask } from "@/src/db/schema";

// Mock dependencies
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

vi.mock("@/src/services/reasoning/reasoning-service", () => ({
  getRecommendation: vi.fn(),
}));

vi.mock("@/src/services/recommendation-context", () => ({
  buildRecommendationContext: vi.fn(),
}));

import { getRosterTask, updateRosterTask } from "./roster-task-service";
import { appendAudit } from "./audit-service";
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

const mockMatchResult = {
  visit_id: 100,
  client_id: 10,
  candidates: [
    {
      employee_id: 1,
      employee_name: "Alice Smith",
      overall: 0.85,
      confidence: "high" as const,
      dimensions: {
        skills: { score: 0.9, confidence: "high" as const, reason: "All skills match" },
        relationship: { score: 0.8, confidence: "medium" as const, reason: "Prior visits" },
        proximity: { score: 0.7, confidence: "high" as const, reason: "5km away" },
        workload: { score: 0.9, confidence: "high" as const, reason: "Light schedule" },
        acceptance: { score: 0.85, confidence: "high" as const, reason: "90% rate" },
      },
      warnings: [],
    },
    {
      employee_id: 2,
      employee_name: "Bob Jones",
      overall: 0.75,
      confidence: "medium" as const,
      dimensions: {
        skills: { score: 0.8, confidence: "high" as const, reason: "Most skills match" },
        relationship: { score: 0.6, confidence: "low" as const, reason: "No prior visits" },
        proximity: { score: 0.8, confidence: "high" as const, reason: "3km away" },
        workload: { score: 0.7, confidence: "medium" as const, reason: "Moderate schedule" },
        acceptance: { score: 0.8, confidence: "high" as const, reason: "85% rate" },
      },
      warnings: [],
    },
    {
      employee_id: 3,
      employee_name: "Carol White",
      overall: 0.70,
      confidence: "medium" as const,
      dimensions: {
        skills: { score: 0.7, confidence: "medium" as const, reason: "Key skills match" },
        relationship: { score: 0.5, confidence: "low" as const, reason: "No history" },
        proximity: { score: 0.9, confidence: "high" as const, reason: "1km away" },
        workload: { score: 0.6, confidence: "medium" as const, reason: "Busy schedule" },
        acceptance: { score: 0.75, confidence: "medium" as const, reason: "80% rate" },
      },
      warnings: [],
    },
  ],
  weights_used: { skills: 0.3, relationship: 0.25, proximity: 0.2, workload: 0.15, acceptance: 0.1 },
  preset_name: "urgent",
  candidate_pool_size: 20,
  eligible_pool_size: 15,
  data_warnings: [],
  match_confidence: "high" as const,
  scored_at: new Date().toISOString(),
};

const mockLLMRecommendation = {
  primary: {
    employee_id: 1,
    employee_name: "Alice Smith",
    explanation: "Best match based on skills and proximity",
    confidence: "high" as const,
  },
  escalation: {
    should_escalate: false,
    reason: null,
    urgency: "informational" as const,
  },
  factors_considered: ["Skills match", "Proximity"],
  trade_offs: ["Slightly higher workload"],
  model: "haiku-4.5",
  usage: { inputTokens: 500, outputTokens: 200 },
};

describe("P1.2 — Reasoning integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should store LLMRecommendation on task when advancing from scoring to reasoning", async () => {
    const task = makeTask({ status: "scoring", version: 3, matchResult: mockMatchResult });
    const updatedTask = makeTask({ status: "reasoning", version: 4, llmRecommendation: mockLLMRecommendation });

    vi.mocked(getRosterTask).mockResolvedValue(task);
    vi.mocked(updateRosterTask).mockResolvedValue(updatedTask);
    vi.mocked(appendAudit).mockResolvedValue(undefined);
    vi.mocked(buildRecommendationContext).mockResolvedValue({
      visit: { id: 100, start_at: "2026-03-12T08:00:00Z", end_at: "2026-03-12T12:00:00Z", status: "vacated" },
      client: { first_name: "John", last_name: "Doe" },
      context: { urgency: "planned" },
    });
    vi.mocked(getRecommendation).mockResolvedValue(mockLLMRecommendation);

    const result = await advanceTask({ uow: makeMockUoW() }, mockCtx, "task-abc");

    expect(result.status).toBe("reasoning");
    expect(updateRosterTask).toHaveBeenCalledWith(
      expect.anything(),
      "user-123",
      "task-abc",
      expect.objectContaining({ llmRecommendation: mockLLMRecommendation }),
      3
    );
  });

  it("should fall back to scoring-only when LLM fails", async () => {
    const task = makeTask({ status: "scoring", version: 3, matchResult: mockMatchResult });
    const updatedTask = makeTask({ status: "reasoning", version: 4 });

    vi.mocked(getRosterTask).mockResolvedValue(task);
    vi.mocked(updateRosterTask).mockResolvedValue(updatedTask);
    vi.mocked(appendAudit).mockResolvedValue(undefined);
    vi.mocked(buildRecommendationContext).mockResolvedValue({
      visit: { id: 100, start_at: "2026-03-12T08:00:00Z", end_at: "2026-03-12T12:00:00Z", status: "vacated" },
      client: { first_name: "John", last_name: "Doe" },
      context: { urgency: "planned" },
    });
    vi.mocked(getRecommendation).mockRejectedValue(new Error("Bedrock timeout"));

    const result = await advanceTask({ uow: makeMockUoW() }, mockCtx, "task-abc");

    expect(result.status).toBe("reasoning");
    // Should store error record with _tag discriminant
    expect(updateRosterTask).toHaveBeenCalledWith(
      expect.anything(),
      "user-123",
      "task-abc",
      expect.objectContaining({
        llmRecommendation: expect.objectContaining({ _tag: "error" }),
      }),
      3
    );
  });
});

describe("P1.2 — Escalation decision flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should escalate immediately when should_escalate + urgency=immediate", async () => {
    const escalationRec = {
      ...mockLLMRecommendation,
      escalation: { should_escalate: true, reason: "No viable candidates", urgency: "immediate" as const },
    };
    const task = makeTask({
      status: "reasoning",
      version: 4,
      matchResult: mockMatchResult,
      llmRecommendation: escalationRec,
    });
    const updatedTask = makeTask({ status: "escalated", version: 5 });

    vi.mocked(getRosterTask).mockResolvedValue(task);
    vi.mocked(updateRosterTask).mockResolvedValue(updatedTask);
    vi.mocked(appendAudit).mockResolvedValue(undefined);

    const result = await advanceTask({ uow: makeMockUoW() }, mockCtx, "task-abc");

    expect(result.status).toBe("escalated");
    expect(updateRosterTask).toHaveBeenCalledWith(
      expect.anything(),
      "user-123",
      "task-abc",
      expect.objectContaining({
        status: "escalated",
        escalationReason: "No viable candidates",
      }),
      4
    );
  });

  it("should advance to contacting when should_escalate + urgency=before_shift", async () => {
    const escalationRec = {
      ...mockLLMRecommendation,
      escalation: { should_escalate: true, reason: "Low confidence", urgency: "before_shift" as const },
    };
    const task = makeTask({
      status: "reasoning",
      version: 4,
      matchResult: mockMatchResult,
      llmRecommendation: escalationRec,
    });
    const updatedTask = makeTask({ status: "contacting", version: 5 });

    vi.mocked(getRosterTask).mockResolvedValue(task);
    vi.mocked(updateRosterTask).mockResolvedValue(updatedTask);
    vi.mocked(appendAudit).mockResolvedValue(undefined);

    const result = await advanceTask({ uow: makeMockUoW() }, mockCtx, "task-abc");

    expect(result.status).toBe("contacting");
  });

  it("should advance to contacting when should_escalate + urgency=informational", async () => {
    const escalationRec = {
      ...mockLLMRecommendation,
      escalation: { should_escalate: true, reason: "Minor concern", urgency: "informational" as const },
    };
    const task = makeTask({
      status: "reasoning",
      version: 4,
      matchResult: mockMatchResult,
      llmRecommendation: escalationRec,
    });
    const updatedTask = makeTask({ status: "contacting", version: 5 });

    vi.mocked(getRosterTask).mockResolvedValue(task);
    vi.mocked(updateRosterTask).mockResolvedValue(updatedTask);
    vi.mocked(appendAudit).mockResolvedValue(undefined);

    const result = await advanceTask({ uow: makeMockUoW() }, mockCtx, "task-abc");

    expect(result.status).toBe("contacting");
  });

  it("should advance to contacting normally when no escalation", async () => {
    const task = makeTask({
      status: "reasoning",
      version: 4,
      matchResult: mockMatchResult,
      llmRecommendation: mockLLMRecommendation,
    });
    const updatedTask = makeTask({ status: "contacting", version: 5 });

    vi.mocked(getRosterTask).mockResolvedValue(task);
    vi.mocked(updateRosterTask).mockResolvedValue(updatedTask);
    vi.mocked(appendAudit).mockResolvedValue(undefined);

    const result = await advanceTask({ uow: makeMockUoW() }, mockCtx, "task-abc");

    expect(result.status).toBe("contacting");
  });
});
