import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/src/db", () => ({
  db: { transaction: vi.fn((fn: (tx: unknown) => unknown) => fn({})) },
}));
vi.mock("@/src/services/rostering/roster-task-service", () => ({
  findActiveTasksByEmployeeContact: vi.fn(),
  updateRosterTask: vi.fn(),
}));
vi.mock("@/src/services/rostering/audit-service", () => ({
  appendAudit: vi.fn(),
}));
vi.mock("@/src/lib/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { handleEmployeeStatusChanged } from "./handle-employee-status-changed";
import { handleEmployeeUnavailability } from "./handle-employee-unavailability";
import { findActiveTasksByEmployeeContact, updateRosterTask } from "@/src/services/rostering/roster-task-service";
import type { AlayaCareEvent } from "@/src/lib/alayacare-events/types";

function makeEvent(type: string, payload: Record<string, unknown>): AlayaCareEvent {
  return {
    event_id: "evt-1",
    event_type: type as AlayaCareEvent["event_type"],
    timestamp: new Date().toISOString(),
    payload,
    metadata: { source: "simulation", trace_id: "t-1" },
  };
}

const taskWithContact = {
  id: "task-1",
  status: "contacting",
  version: 3,
  contacts: [
    { employee_id: 42, response: "pending", employee_name: "Alice" },
    { employee_id: 99, response: "pending", employee_name: "Bob" },
  ],
};

describe("handleEmployeeStatusChanged", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should expire contacts when employee is terminated", async () => {
    vi.mocked(findActiveTasksByEmployeeContact).mockResolvedValue([taskWithContact as never]);
    vi.mocked(updateRosterTask).mockResolvedValue({ ...taskWithContact, status: "cascading" } as never);

    const result = await handleEmployeeStatusChanged(
      makeEvent("employee.status_changed", { employee_id: 42, status: "terminated" }),
      "trace-1"
    ) as Record<string, unknown>;

    expect(result.affected_tasks).toBe(1);
    expect(updateRosterTask).toHaveBeenCalledWith(
      expect.anything(), "system", "task-1",
      expect.objectContaining({ status: "cascading" }),
      3
    );

    // Check that only employee 42's contact was expired
    const passedContacts = vi.mocked(updateRosterTask).mock.calls[0][3].contacts as Array<{ employee_id: number; response: string }>;
    expect(passedContacts[0].response).toBe("expired");
    expect(passedContacts[1].response).toBe("pending");
  });

  it("should log non-termination status changes", async () => {
    const result = await handleEmployeeStatusChanged(
      makeEvent("employee.status_changed", { employee_id: 42, status: "active" }),
      "trace-1"
    ) as Record<string, unknown>;

    expect(result.action).toBe("logged");
    expect(findActiveTasksByEmployeeContact).not.toHaveBeenCalled();
  });
});

describe("handleEmployeeUnavailability", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should expire contacts for unavailable employee", async () => {
    vi.mocked(findActiveTasksByEmployeeContact).mockResolvedValue([taskWithContact as never]);
    vi.mocked(updateRosterTask).mockResolvedValue({ ...taskWithContact, status: "cascading" } as never);

    const result = await handleEmployeeUnavailability(
      makeEvent("employee.unavailability.created", { employee_id: 42, unavailability_id: "u-1" }),
      "trace-1"
    ) as Record<string, unknown>;

    expect(result.action).toBe("contacts_expired");
    expect(result.affected_tasks).toBe(1);
  });

  it("should return logged when no active tasks", async () => {
    vi.mocked(findActiveTasksByEmployeeContact).mockResolvedValue([]);

    const result = await handleEmployeeUnavailability(
      makeEvent("employee.unavailability.created", { employee_id: 99, unavailability_id: "u-2" }),
      "trace-1"
    ) as Record<string, unknown>;

    expect(result.action).toBe("logged");
    expect(result.affected_tasks).toBe(0);
  });

  it("should skip tasks where employee has no pending contact", async () => {
    const taskWithDeclinedContact = {
      ...taskWithContact,
      contacts: [{ employee_id: 42, response: "declined", employee_name: "Alice" }],
    };
    vi.mocked(findActiveTasksByEmployeeContact).mockResolvedValue([taskWithDeclinedContact as never]);

    const result = await handleEmployeeUnavailability(
      makeEvent("employee.unavailability.created", { employee_id: 42, unavailability_id: "u-3" }),
      "trace-1"
    ) as Record<string, unknown>;

    expect(result.affected_tasks).toBe(0);
    expect(updateRosterTask).not.toHaveBeenCalled();
  });
});
