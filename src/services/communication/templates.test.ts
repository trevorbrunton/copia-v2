import { describe, it, expect } from "vitest";
import {
  buildShiftOfferSMS,
  buildConfirmationSMS,
  buildCancellationSMS,
  buildShiftOfferEmail,
  buildDailySummaryEmail,
  buildWeeklyReportEmail,
} from "./templates";

describe("buildShiftOfferSMS", () => {
  it("should include all variables in output", () => {
    const result = buildShiftOfferSMS({
      name: "Alice",
      client: "Mrs Smith",
      date: "2026-03-12",
      time: "08:00",
      expiryMinutes: 20,
    });
    expect(result).toContain("Alice");
    expect(result).toContain("Mrs Smith");
    expect(result).toContain("2026-03-12");
    expect(result).toContain("08:00");
    expect(result).toContain("20 min");
    expect(result).toContain("YES");
    expect(result).toContain("NO");
  });
});

describe("buildConfirmationSMS", () => {
  it("should include assignment details", () => {
    const result = buildConfirmationSMS({
      name: "Alice",
      client: "Mrs Smith",
      date: "2026-03-12",
      time: "08:00",
    });
    expect(result).toContain("Confirmed");
    expect(result).toContain("Alice");
    expect(result).toContain("Mrs Smith");
  });
});

describe("buildCancellationSMS", () => {
  it("should include cancellation reason", () => {
    const result = buildCancellationSMS({
      name: "Alice",
      reason: "Visit rescheduled",
    });
    expect(result).toContain("cancelled");
    expect(result).toContain("Visit rescheduled");
  });
});

describe("buildShiftOfferEmail", () => {
  it("should include shift details in HTML", () => {
    const result = buildShiftOfferEmail({
      employeeName: "Alice",
      clientName: "Mrs Smith",
      date: "2026-03-15",
      time: "08:00",
      duration: "4 hours",
      requirements: "Medication admin",
    });
    expect(result.subject).toContain("Mrs Smith");
    expect(result.html).toContain("Alice");
    expect(result.html).toContain("2026-03-15");
    expect(result.html).toContain("Medication admin");
  });

  it("should omit requirements row when not provided", () => {
    const result = buildShiftOfferEmail({
      employeeName: "Bob",
      clientName: "Mr Jones",
      date: "2026-03-15",
      time: "10:00",
      duration: "2 hours",
    });
    expect(result.html).not.toContain("Requirements");
  });
});

describe("buildDailySummaryEmail", () => {
  it("should calculate fill rate percentage", () => {
    const result = buildDailySummaryEmail({
      date: "2026-03-15",
      totalTasks: 20,
      filledAutonomously: 15,
      escalated: 3,
      avgTimeToFillMinutes: 45,
      pendingCount: 2,
    });
    expect(result.subject).toContain("2026-03-15");
    expect(result.html).toContain("75%"); // 15/20
    expect(result.html).toContain("45 min");
  });

  it("should handle zero tasks gracefully", () => {
    const result = buildDailySummaryEmail({
      date: "2026-03-15",
      totalTasks: 0,
      filledAutonomously: 0,
      escalated: 0,
      avgTimeToFillMinutes: null,
      pendingCount: 0,
    });
    expect(result.html).toContain("0%");
    expect(result.html).toContain("N/A");
  });
});

describe("buildWeeklyReportEmail", () => {
  it("should include metrics and decline reasons", () => {
    const result = buildWeeklyReportEmail({
      weekStart: "2026-03-09",
      weekEnd: "2026-03-15",
      totalTasks: 50,
      autonomousFillRate: 0.82,
      avgTimeToFillMinutes: 32,
      escalationRate: 0.12,
      topDeclineReasons: [
        { reason: "Already booked", count: 5 },
        { reason: "Too far", count: 3 },
      ],
    });
    expect(result.subject).toContain("2026-03-09");
    expect(result.html).toContain("82%");
    expect(result.html).toContain("12%");
    expect(result.html).toContain("Already booked");
  });
});
