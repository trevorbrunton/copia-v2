import { describe, it, expect, vi, afterEach } from "vitest";
import { classifyUrgency, getUrgencyConfig } from "./urgency-classifier";

describe("classifyUrgency", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return urgent when shift is less than 4 hours away", () => {
    const twoHoursFromNow = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    expect(classifyUrgency({ start_at: twoHoursFromNow })).toBe("urgent");
  });

  it("should return planned when shift is more than 4 hours away", () => {
    const eightHoursFromNow = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
    expect(classifyUrgency({ start_at: eightHoursFromNow })).toBe("planned");
  });

  it("should return urgent when service instructions contain URGENT", () => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    expect(
      classifyUrgency({
        start_at: tomorrow,
        service_instructions: "URGENT: patient critical",
      })
    ).toBe("urgent");
  });

  it("should return planned for shift tomorrow without URGENT flag", () => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    expect(classifyUrgency({ start_at: tomorrow })).toBe("planned");
  });
});

describe("getUrgencyConfig", () => {
  it("should return parallel cascade for urgent", () => {
    const config = getUrgencyConfig("urgent");
    expect(config.cascadeStrategy).toBe("parallel");
    expect(config.expiryMinutes).toBe(20);
    expect(config.escalationThreshold).toEqual({ type: "time", minutes: 15 });
  });

  it("should return sequential cascade for planned", () => {
    const config = getUrgencyConfig("planned");
    expect(config.cascadeStrategy).toBe("sequential");
    expect(config.expiryMinutes).toBe(120);
    expect(config.escalationThreshold).toEqual({ type: "contacts", count: 10 });
  });
});
