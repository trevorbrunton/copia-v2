import { describe, it, expect } from "vitest";
import { validateMatchInputs } from "./data-validator";

describe("validateMatchInputs", () => {
  const validVisit = { id: 1, client_id: 10, start_at: new Date(Date.now() + 86400000).toISOString(), latitude: -33.8, longitude: 151.2 };
  const validClient = { id: 10 };
  const validEmployees = [
    { id: 1, status: "active" },
    { id: 2, status: "active" },
    { id: 3, status: "active" },
  ];

  it("should pass with valid inputs", () => {
    const result = validateMatchInputs(validVisit, validClient, validEmployees);
    expect(result.valid).toBe(true);
    expect(result.blockers).toHaveLength(0);
  });

  it("should block when visit is null", () => {
    const result = validateMatchInputs(null, validClient, validEmployees);
    expect(result.valid).toBe(false);
    expect(result.blockers).toContain("Visit not found");
  });

  it("should block when no client associated", () => {
    const visit = { id: 1, start_at: new Date(Date.now() + 86400000).toISOString() };
    const result = validateMatchInputs(visit, null, validEmployees);
    expect(result.valid).toBe(false);
    expect(result.blockers).toContain("No client associated with visit");
  });

  it("should block when no employees found", () => {
    const result = validateMatchInputs(validVisit, validClient, []);
    expect(result.valid).toBe(false);
    expect(result.blockers).toContain("No eligible employees found");
  });

  it("should warn when visit start time is in the past", () => {
    const pastVisit = { ...validVisit, start_at: new Date(Date.now() - 86400000).toISOString() };
    const result = validateMatchInputs(pastVisit, validClient, validEmployees);
    expect(result.valid).toBe(true);
    expect(result.warnings).toContain("Visit start time is in the past");
  });

  it("should warn when visit missing GPS coordinates", () => {
    const noGpsVisit = { ...validVisit, latitude: null, longitude: null };
    const result = validateMatchInputs(noGpsVisit, validClient, validEmployees);
    expect(result.valid).toBe(true);
    expect(result.warnings).toContain("Visit missing GPS coordinates — distance scoring will be skipped");
  });

  it("should warn when fewer than 3 active employees", () => {
    const fewEmployees = [{ id: 1, status: "active" }];
    const result = validateMatchInputs(validVisit, validClient, fewEmployees);
    expect(result.valid).toBe(true);
    expect(result.warnings).toContain("Only 1 active employee(s) — limited candidate pool");
  });

  it("should warn when visit has no start time", () => {
    const noStartVisit = { id: 1, client_id: 10, latitude: -33.8, longitude: 151.2 };
    const result = validateMatchInputs(noStartVisit, validClient, validEmployees);
    expect(result.warnings).toContain("Visit has no start time");
  });
});
