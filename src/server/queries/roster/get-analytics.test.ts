import { describe, it, expect } from "vitest";
import { AnalyticsInput } from "./get-analytics";

describe("AnalyticsInput validation", () => {
  it("should apply default 30 days", () => {
    const result = AnalyticsInput.parse({});
    expect(result.days).toBe(30);
  });

  it("should accept valid day counts", () => {
    expect(AnalyticsInput.parse({ days: "7" }).days).toBe(7);
    expect(AnalyticsInput.parse({ days: "90" }).days).toBe(90);
  });

  it("should reject days > 90", () => {
    expect(() => AnalyticsInput.parse({ days: "91" })).toThrow();
  });

  it("should reject days < 1", () => {
    expect(() => AnalyticsInput.parse({ days: "0" })).toThrow();
  });

  it("should coerce string to number", () => {
    const result = AnalyticsInput.parse({ days: "14" });
    expect(result.days).toBe(14);
  });
});
