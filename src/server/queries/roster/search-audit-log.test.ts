import { describe, it, expect } from "vitest";
import { AuditSearchInput } from "./search-audit-log";

describe("AuditSearchInput validation", () => {
  it("should accept valid search params", () => {
    const result = AuditSearchInput.parse({
      task_id: "550e8400-e29b-41d4-a716-446655440000",
      action: "task_created",
      actor: "system",
      limit: "25",
      offset: "0",
    });
    expect(result.task_id).toBe("550e8400-e29b-41d4-a716-446655440000");
    expect(result.limit).toBe(25);
    expect(result.offset).toBe(0);
  });

  it("should apply defaults for limit and offset", () => {
    const result = AuditSearchInput.parse({});
    expect(result.limit).toBe(50);
    expect(result.offset).toBe(0);
  });

  it("should reject invalid task_id", () => {
    expect(() => AuditSearchInput.parse({ task_id: "not-a-uuid" })).toThrow();
  });

  it("should clamp limit to 200", () => {
    expect(() => AuditSearchInput.parse({ limit: "500" })).toThrow();
  });

  it("should accept date range params", () => {
    const result = AuditSearchInput.parse({
      from_date: "2026-03-01T00:00:00Z",
      to_date: "2026-03-11T23:59:59Z",
    });
    expect(result.from_date).toBe("2026-03-01T00:00:00Z");
    expect(result.to_date).toBe("2026-03-11T23:59:59Z");
  });
});
