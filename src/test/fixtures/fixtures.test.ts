import { describe, it, expect } from "vitest";
import {
  MOCK_EMPLOYEES,
  EMPLOYEES_WITHOUT_COORDS,
  ACTIVE_EMPLOYEES,
  INACTIVE_EMPLOYEES,
  MOCK_EMPLOYEE_SKILLS,
  EMPLOYEES_WITH_NO_SKILLS,
  EMPLOYEES_WITH_EXPIRED_SKILLS,
  MOCK_VISITS,
  COMPLETED_VISITS,
  VACANT_VISITS,
  VISITS_WITHOUT_CLIENT,
  OVERLAPPING_VISITS,
  VISITS_WITHOUT_REQUIRED_SKILLS,
  MOCK_OFFERS,
  HIGH_ACCEPTANCE_EMPLOYEES,
  HIGH_DECLINE_EMPLOYEES,
  NO_HISTORY_EMPLOYEES,
} from "./index";

describe("Mock Data Fixtures", () => {
  describe("employees", () => {
    it("should have 150 employees", () => {
      expect(MOCK_EMPLOYEES).toHaveLength(150);
    });

    it("should have 10 employees without coordinates", () => {
      expect(EMPLOYEES_WITHOUT_COORDS).toHaveLength(10);
    });

    it("should have employees with various statuses", () => {
      expect(ACTIVE_EMPLOYEES.length).toBeGreaterThan(140);
      expect(INACTIVE_EMPLOYEES.length).toBe(5); // 3 inactive + 2 on_leave
    });

    it("should have unique IDs", () => {
      const ids = new Set(MOCK_EMPLOYEES.map((e) => e.id));
      expect(ids.size).toBe(150);
    });
  });

  describe("skills", () => {
    it("should have skill records for all 150 employees", () => {
      expect(MOCK_EMPLOYEE_SKILLS).toHaveLength(150);
    });

    it("should have 10 employees with no skills", () => {
      expect(EMPLOYEES_WITH_NO_SKILLS).toHaveLength(10);
    });

    it("should have 5 employees with only expired skills", () => {
      expect(EMPLOYEES_WITH_EXPIRED_SKILLS).toHaveLength(5);
    });
  });

  describe("visits", () => {
    it("should have 55 visits (50 base + 5 overlap)", () => {
      expect(MOCK_VISITS).toHaveLength(55);
    });

    it("should have completed visits with clock data", () => {
      expect(COMPLETED_VISITS.length).toBeGreaterThan(0);
      for (const v of COMPLETED_VISITS) {
        expect(v.clock_in).not.toBeNull();
        expect(v.clock_out).not.toBeNull();
      }
    });

    it("should have vacant visits without employees", () => {
      expect(VACANT_VISITS.length).toBe(5);
      for (const v of VACANT_VISITS) {
        expect(v.employee_id).toBeNull();
      }
    });

    it("should have visits without client", () => {
      expect(VISITS_WITHOUT_CLIENT.length).toBe(5);
      for (const v of VISITS_WITHOUT_CLIENT) {
        expect(v.client_id).toBeNull();
      }
    });

    it("should have overlapping visits for conflict testing", () => {
      expect(OVERLAPPING_VISITS).toHaveLength(5);
    });

    it("should have visits without required skills", () => {
      expect(VISITS_WITHOUT_REQUIRED_SKILLS.length).toBeGreaterThanOrEqual(5);
    });
  });

  describe("offers", () => {
    it("should have offers", () => {
      expect(MOCK_OFFERS.length).toBeGreaterThan(100);
    });

    it("should have high acceptance employees with ~95% rate", () => {
      for (const empId of HIGH_ACCEPTANCE_EMPLOYEES) {
        const empOffers = MOCK_OFFERS.filter((o) => o.employee_id === empId);
        const accepted = empOffers.filter((o) => o.status === "accepted").length;
        expect(accepted / empOffers.length).toBeGreaterThan(0.9);
      }
    });

    it("should have high decline employees with ~10% acceptance", () => {
      for (const empId of HIGH_DECLINE_EMPLOYEES) {
        const empOffers = MOCK_OFFERS.filter((o) => o.employee_id === empId);
        const accepted = empOffers.filter((o) => o.status === "accepted").length;
        expect(accepted / empOffers.length).toBeLessThan(0.2);
      }
    });

    it("should have no offers for no-history employees", () => {
      for (const empId of NO_HISTORY_EMPLOYEES) {
        const empOffers = MOCK_OFFERS.filter((o) => o.employee_id === empId);
        expect(empOffers).toHaveLength(0);
      }
    });
  });
});
