import { describe, it, expect } from "vitest";
import {
  CreateRosterTaskInput,
  RosterTaskStatusFilter,
  ROSTER_TASK_STATUSES,
  TERMINAL_STATUSES,
} from "./types";

describe("CreateRosterTaskInput", () => {
  it("should accept valid input with visit_id only", () => {
    const result = CreateRosterTaskInput.parse({ visit_id: 123 });
    expect(result.visit_id).toBe(123);
    expect(result.client_id).toBeUndefined();
    expect(result.urgency).toBeUndefined();
  });

  it("should accept valid input with all fields", () => {
    const result = CreateRosterTaskInput.parse({
      visit_id: 123,
      client_id: 456,
      urgency: "urgent",
    });
    expect(result.visit_id).toBe(123);
    expect(result.client_id).toBe(456);
    expect(result.urgency).toBe("urgent");
  });

  it("should reject missing visit_id", () => {
    expect(() => CreateRosterTaskInput.parse({})).toThrow();
  });

  it("should reject negative visit_id", () => {
    expect(() => CreateRosterTaskInput.parse({ visit_id: -1 })).toThrow();
  });

  it("should reject invalid urgency", () => {
    expect(() =>
      CreateRosterTaskInput.parse({ visit_id: 1, urgency: "critical" })
    ).toThrow();
  });
});

describe("RosterTaskStatusFilter", () => {
  it("should accept empty input with defaults", () => {
    const result = RosterTaskStatusFilter.parse({});
    expect(result.status).toBeUndefined();
    expect(result.limit).toBe(50);
    expect(result.offset).toBe(0);
  });

  it("should accept valid status filter", () => {
    const result = RosterTaskStatusFilter.parse({ status: "escalated" });
    expect(result.status).toBe("escalated");
  });

  it("should reject invalid status", () => {
    expect(() =>
      RosterTaskStatusFilter.parse({ status: "invalid" })
    ).toThrow();
  });

  it("should reject limit > 100", () => {
    expect(() =>
      RosterTaskStatusFilter.parse({ limit: 200 })
    ).toThrow();
  });
});

describe("TERMINAL_STATUSES", () => {
  it("should contain the correct terminal states", () => {
    expect(TERMINAL_STATUSES.has("assigned")).toBe(true);
    expect(TERMINAL_STATUSES.has("escalated")).toBe(true);
    expect(TERMINAL_STATUSES.has("completed")).toBe(true);
    expect(TERMINAL_STATUSES.has("cancelled")).toBe(true);
  });

  it("should not contain non-terminal states", () => {
    expect(TERMINAL_STATUSES.has("detected")).toBe(false);
    expect(TERMINAL_STATUSES.has("contacting")).toBe(false);
  });

  it("should have 11 total roster task statuses", () => {
    expect(ROSTER_TASK_STATUSES.length).toBe(11);
  });
});
