import { describe, it, expect, vi } from "vitest";
import { analysePatterns, type PatternInsight } from "./pattern-recognition";

// Mock the db module
vi.mock("@/src/db/schema", () => ({
  rosterTasks: {
    id: "id",
    userId: "user_id",
    clientId: "client_id",
    status: "status",
    contacts: "contacts",
    assignedEmployeeId: "assigned_employee_id",
    createdAt: "created_at",
  },
}));

function makeTx(rows: unknown[]) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(rows),
  };
  return chain as unknown;
}

describe("analysePatterns", () => {
  it("should detect always_declines pattern", async () => {
    const tasks = [
      { id: "t1", clientId: 1, status: "assigned", assignedEmployeeId: 10, contacts: [
        { employee_id: 5, employee_name: "Eve", response: "declined", rank: 0 },
        { employee_id: 10, employee_name: "Tom", response: "accepted", rank: 1 },
      ]},
      { id: "t2", clientId: 1, status: "assigned", assignedEmployeeId: 10, contacts: [
        { employee_id: 5, employee_name: "Eve", response: "declined", rank: 0 },
        { employee_id: 10, employee_name: "Tom", response: "accepted", rank: 1 },
      ]},
      { id: "t3", clientId: 1, status: "assigned", assignedEmployeeId: 10, contacts: [
        { employee_id: 5, employee_name: "Eve", response: "declined", rank: 0 },
        { employee_id: 10, employee_name: "Tom", response: "accepted", rank: 1 },
      ]},
    ];

    const tx = makeTx(tasks);
    const insights = await analysePatterns(tx as never, "user-1");

    const declineInsights = insights.filter((i: PatternInsight) => i.type === "always_declines");
    expect(declineInsights).toHaveLength(1);
    expect(declineInsights[0].evidence).toMatchObject({ employee_id: 5, declines: 3, total: 3 });
  });

  it("should detect never_accepts pattern", async () => {
    // Eve has <80% decline rate (2/5 = 40%) but 0 accepts — triggers never_accepts without always_declines
    const tasks = [
      { id: "t1", clientId: 1, status: "escalated", assignedEmployeeId: null, contacts: [
        { employee_id: 5, employee_name: "Eve", response: "declined", rank: 0 },
      ]},
      { id: "t2", clientId: 1, status: "escalated", assignedEmployeeId: null, contacts: [
        { employee_id: 5, employee_name: "Eve", response: "expired", rank: 0 },
      ]},
      { id: "t3", clientId: 1, status: "escalated", assignedEmployeeId: null, contacts: [
        { employee_id: 5, employee_name: "Eve", response: "declined", rank: 0 },
      ]},
      { id: "t4", clientId: 1, status: "escalated", assignedEmployeeId: null, contacts: [
        { employee_id: 5, employee_name: "Eve", response: "expired", rank: 0 },
      ]},
      { id: "t5", clientId: 1, status: "escalated", assignedEmployeeId: null, contacts: [
        { employee_id: 5, employee_name: "Eve", response: "expired", rank: 0 },
      ]},
    ];

    const tx = makeTx(tasks);
    const insights = await analysePatterns(tx as never, "user-1");

    const neverAccepts = insights.filter((i: PatternInsight) => i.type === "never_accepts");
    expect(neverAccepts).toHaveLength(1);
    expect(neverAccepts[0].evidence).toMatchObject({ employee_id: 5, contacts: 5 });
  });

  it("should detect client_churn pattern", async () => {
    const tasks = Array.from({ length: 5 }, (_, i) => ({
      id: `t${i}`,
      clientId: 42,
      status: "assigned",
      assignedEmployeeId: i + 1, // 5 different caregivers
      contacts: [{ employee_id: i + 1, employee_name: `Worker${i}`, response: "accepted", rank: 0 }],
    }));

    const tx = makeTx(tasks);
    const insights = await analysePatterns(tx as never, "user-1");

    const churn = insights.filter((i: PatternInsight) => i.type === "client_churn");
    expect(churn).toHaveLength(1);
    expect(churn[0].evidence).toMatchObject({ client_id: 42, unique_caregivers: 5 });
  });

  it("should detect high escalation rate", async () => {
    const tasks = [
      { id: "t1", clientId: 1, status: "escalated", assignedEmployeeId: null, contacts: [] },
      { id: "t2", clientId: 1, status: "escalated", assignedEmployeeId: null, contacts: [] },
      { id: "t3", clientId: 1, status: "assigned", assignedEmployeeId: 1, contacts: [] },
      { id: "t4", clientId: 1, status: "escalated", assignedEmployeeId: null, contacts: [] },
      { id: "t5", clientId: 1, status: "assigned", assignedEmployeeId: 2, contacts: [] },
    ];

    const tx = makeTx(tasks);
    const insights = await analysePatterns(tx as never, "user-1");

    const preset = insights.filter((i: PatternInsight) => i.type === "preset_performance");
    expect(preset).toHaveLength(1);
    expect(preset[0].evidence).toMatchObject({ escalated: 3, total: 5 });
  });

  it("should return empty insights for no tasks", async () => {
    const tx = makeTx([]);
    const insights = await analysePatterns(tx as never, "user-1");
    expect(insights).toHaveLength(0);
  });
});
