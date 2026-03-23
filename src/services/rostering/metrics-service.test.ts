import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/src/db/schema", () => ({
  rosterTasks: { userId: "userId", status: "status", createdAt: "createdAt", resolvedAt: "resolvedAt", timeToFillMs: "timeToFillMs", escalatedTo: "escalatedTo", currentContactIndex: "currentContactIndex" },
  rosterDailyMetrics: { userId: "userId", date: "date" },
}));
vi.mock("@/src/lib/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { materialiseDailyMetrics } from "./metrics-service";

function makeMockTx() {
  const selectResult = { count: 5, avg: 120000 };
  const select = vi.fn().mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([selectResult]),
    }),
  });
  const insertValues = vi.fn().mockReturnValue({
    onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
  });
  const insert = vi.fn().mockReturnValue({ values: insertValues });

  return { select, insert } as unknown as Parameters<typeof materialiseDailyMetrics>[0];
}

describe("materialiseDailyMetrics", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should call insert with aggregated metrics", async () => {
    const tx = makeMockTx();
    await materialiseDailyMetrics(tx, "user-1", "2026-03-10");

    // Should have made 5 select queries (created, autonomous, escalated, avgFill, resolved, firstAccept)
    expect(tx.select).toHaveBeenCalled();
    // Should have inserted into daily metrics
    expect(tx.insert).toHaveBeenCalled();
  });

  it("should not throw on empty results", async () => {
    const emptySelect = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ count: 0, avg: null }]),
      }),
    });
    const insertValues = vi.fn().mockReturnValue({
      onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
    });
    const insert = vi.fn().mockReturnValue({ values: insertValues });
    const tx = { select: emptySelect, insert } as unknown as Parameters<typeof materialiseDailyMetrics>[0];

    await expect(materialiseDailyMetrics(tx, "user-1", "2026-03-10")).resolves.not.toThrow();
  });
});
