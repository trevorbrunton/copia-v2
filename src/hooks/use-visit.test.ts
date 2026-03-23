import { describe, it, expect } from "vitest";
import { buildVisitQueryKey } from "./use-visit";

describe("buildVisitQueryKey", () => {
  it("should return query key with visit id", () => {
    expect(buildVisitQueryKey(42)).toEqual(["visit", 42]);
  });

  it("should return query key with null", () => {
    expect(buildVisitQueryKey(null)).toEqual(["visit", null]);
  });
});
