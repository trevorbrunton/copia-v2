import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildRecommendFetchOptions } from "./use-recommendation";

describe("buildRecommendFetchOptions", () => {
  it("should build POST request with preset", () => {
    const opts = buildRecommendFetchOptions({ preset: "urgent" });
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body as string)).toEqual({ preset: "urgent" });
  });

  it("should build POST request with weights", () => {
    const weights = { skills: 0.2, relationship: 0.2, proximity: 0.2, workload: 0.2, acceptance: 0.2 };
    const opts = buildRecommendFetchOptions({ weights });
    expect(JSON.parse(opts.body as string)).toEqual({ weights });
  });

  it("should omit undefined fields", () => {
    const opts = buildRecommendFetchOptions({});
    expect(JSON.parse(opts.body as string)).toEqual({});
  });

  it("should include limit when provided", () => {
    const opts = buildRecommendFetchOptions({ preset: "planned", limit: 5 });
    expect(JSON.parse(opts.body as string)).toEqual({ preset: "planned", limit: 5 });
  });
});
