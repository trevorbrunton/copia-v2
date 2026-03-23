import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AlayaCareEvent } from "@/src/lib/alayacare-events/types";

// Mock all external dependencies used by the extended handlers
vi.mock("@/src/db", () => ({
  db: { transaction: vi.fn((fn: (tx: unknown) => unknown) => fn({})) },
}));
vi.mock("@/src/services/rostering/roster-task-service", () => ({
  findActiveTasksByVisit: vi.fn().mockResolvedValue([]),
  findActiveTasksByEmployeeContact: vi.fn().mockResolvedValue([]),
  updateRosterTask: vi.fn(),
}));
vi.mock("@/src/services/rostering/audit-service", () => ({
  appendAudit: vi.fn(),
}));
vi.mock("@/src/lib/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/src/services/scoring", () => ({
  computeMatch: vi.fn(),
}));
vi.mock("@/src/services/reasoning", () => ({
  getRecommendation: vi.fn(),
}));
vi.mock("@/src/services/recommendation-context", () => ({
  buildRecommendationContext: vi.fn(),
}));

import { handleEmployeeStatusChanged } from "@/src/server/commands/webhooks/handle-employee-status-changed";
import { handleEmployeeUnavailability } from "@/src/server/commands/webhooks/handle-employee-unavailability";
import { handleVisitCreated } from "@/src/server/commands/webhooks/handle-visit-created";
import { handleClientCreated } from "@/src/server/commands/webhooks/handle-client-created";
import { findActiveTasksByEmployeeContact } from "@/src/services/rostering/roster-task-service";

function makeEvent(
  eventType: string,
  payload: Record<string, unknown>
): AlayaCareEvent {
  return {
    event_id: "evt-test",
    event_type: eventType as AlayaCareEvent["event_type"],
    timestamp: "2026-03-11T10:00:00Z",
    payload,
    metadata: { source: "simulation", trace_id: "sim-trace" },
  };
}

describe("handleEmployeeStatusChanged", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns resignation_detected for terminated status with no active tasks", async () => {
    vi.mocked(findActiveTasksByEmployeeContact).mockResolvedValue([]);

    const event = makeEvent("employee.status_changed", {
      employee_id: 5,
      status: "terminated",
      previous_status: "active",
      reason: "resignation",
    });

    const result = await handleEmployeeStatusChanged(event, "trace-1") as Record<string, unknown>;

    expect(result.action).toBe("resignation_detected");
    expect(result.affected_tasks).toBe(0);
  });

  it("returns logged action for non-termination status change", async () => {
    const event = makeEvent("employee.status_changed", {
      employee_id: 5,
      status: "on_leave",
      previous_status: "active",
    });

    const result = await handleEmployeeStatusChanged(event, "trace-1") as Record<string, unknown>;

    expect(result.action).toBe("logged");
  });
});

describe("handleEmployeeUnavailability", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns logged action when no active tasks", async () => {
    vi.mocked(findActiveTasksByEmployeeContact).mockResolvedValue([]);

    const event = makeEvent("employee.unavailability.created", {
      employee_id: 5,
      unavailability_id: 99,
    });

    const result = await handleEmployeeUnavailability(event, "trace-1") as Record<string, unknown>;

    expect(result.action).toBe("logged");
    expect(result.affected_tasks).toBe(0);
  });
});

describe("handleVisitCreated", () => {
  it("returns logged action for visit with assigned employee", async () => {
    const event = makeEvent("visit.created", {
      visit_id: 100,
      client_id: 10,
      employee_id: 5,
      start_at: "2026-03-12T08:00:00Z",
    });

    const result = await handleVisitCreated(event, "trace-1") as Record<string, unknown>;

    expect(result.visit_id).toBe(100);
    expect(result.status).toBe("logged");
  });
});

describe("handleClientCreated", () => {
  it("returns logged action with client details", async () => {
    const event = makeEvent("client.created", {
      client_id: 20,
      first_name: "John",
      last_name: "Smith",
      care_needs: "mobility assistance",
    });

    const result = await handleClientCreated(event, "trace-1") as Record<string, unknown>;

    expect(result.client_id).toBe(20);
    expect(result.action).toBe("logged");
  });
});
