import { describe, it, expect } from "vitest";
import { buildMatchFetchOptions } from "./use-match";

describe("buildMatchFetchOptions", () => {
  it("returns empty body for no options", () => {
    const result = buildMatchFetchOptions({});
    expect(result).toEqual({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
  });

  it("includes preset in body", () => {
    const result = buildMatchFetchOptions({ preset: "urgent" });
    expect(JSON.parse(result.body as string)).toEqual({ preset: "urgent" });
  });

  it("includes weights in body", () => {
    const weights = { skills: 0.2, relationship: 0.2, proximity: 0.2, workload: 0.2, acceptance: 0.2 };
    const result = buildMatchFetchOptions({ weights });
    expect(JSON.parse(result.body as string)).toEqual({ weights });
  });

  it("includes limit in body", () => {
    const result = buildMatchFetchOptions({ limit: 5 });
    expect(JSON.parse(result.body as string)).toEqual({ limit: 5 });
  });

  it("includes all options in body", () => {
    const weights = { skills: 0.2, relationship: 0.2, proximity: 0.2, workload: 0.2, acceptance: 0.2 };
    const result = buildMatchFetchOptions({ weights, limit: 10 });
    expect(JSON.parse(result.body as string)).toEqual({ weights, limit: 10 });
  });

  it("strips undefined values from body", () => {
    const result = buildMatchFetchOptions({ preset: undefined, limit: undefined });
    expect(JSON.parse(result.body as string)).toEqual({});
  });
});
