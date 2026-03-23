import { describe, it, expect } from "vitest";
import { getShiftStatus, type ShiftStatusInput } from "./visit-status";

const BASE_VISIT: ShiftStatusInput = {
  status: "scheduled",
  clock_in: null,
  clock_out: null,
  start_at: "2026-03-15T09:00:00Z",
  end_at: "2026-03-15T11:00:00Z",
};

describe("getShiftStatus", () => {
  it("should return 'Shift Completed' when both clock_in and clock_out exist", () => {
    const visit = {
      ...BASE_VISIT,
      clock_in: "2026-03-15T09:02:00Z",
      clock_out: "2026-03-15T11:05:00Z",
    };
    const result = getShiftStatus(visit);
    expect(result).toEqual({ label: "Shift Completed", variant: "completed" });
  });

  it("should return 'In Progress' when clock_in exists but no clock_out", () => {
    const visit = {
      ...BASE_VISIT,
      clock_in: "2026-03-15T09:02:00Z",
    };
    const now = new Date("2026-03-15T10:00:00Z");
    const result = getShiftStatus(visit, now);
    expect(result).toEqual({ label: "In Progress", variant: "clocked" });
  });

  it("should return 'Missed' when past end time with no clock_in", () => {
    const now = new Date("2026-03-15T12:00:00Z");
    const result = getShiftStatus(BASE_VISIT, now);
    expect(result).toEqual({ label: "Missed", variant: "missed" });
  });

  it("should return 'Late' when past start time but before end time with no clock_in", () => {
    const now = new Date("2026-03-15T09:30:00Z");
    const result = getShiftStatus(BASE_VISIT, now);
    expect(result).toEqual({ label: "Late", variant: "late" });
  });

  it("should return 'Scheduled' when before start time with no clock_in", () => {
    const now = new Date("2026-03-15T08:00:00Z");
    const result = getShiftStatus(BASE_VISIT, now);
    expect(result).toEqual({ label: "Scheduled", variant: "scheduled" });
  });

  it("should return 'Scheduled' for exactly at start time with no clock_in", () => {
    const now = new Date("2026-03-15T09:00:00Z");
    const result = getShiftStatus(BASE_VISIT, now);
    expect(result).toEqual({ label: "Scheduled", variant: "scheduled" });
  });
});
