import { describe, expect, it } from "vitest";
import { parseNumeric } from "@/src/screen/numeric";

describe("parseNumeric", () => {
  it("returns null for null/undefined/empty input", () => {
    expect(parseNumeric(null)).toBeNull();
    expect(parseNumeric(undefined)).toBeNull();
    expect(parseNumeric("")).toBeNull();
  });

  it("parses numeric strings", () => {
    expect(parseNumeric("123")).toBe(123);
    expect(parseNumeric("123.45")).toBe(123.45);
    expect(parseNumeric("-50.5")).toBe(-50.5);
    expect(parseNumeric("0")).toBe(0);
  });

  it("passes numbers through unchanged", () => {
    expect(parseNumeric(123)).toBe(123);
    expect(parseNumeric(0)).toBe(0);
    expect(parseNumeric(-1)).toBe(-1);
  });

  it("returns null for non-finite values (NaN, Infinity, garbage)", () => {
    expect(parseNumeric("abc")).toBeNull();
    expect(parseNumeric("N/A")).toBeNull();
    expect(parseNumeric("12.3.4")).toBeNull();
    expect(parseNumeric(Number.NaN)).toBeNull();
    expect(parseNumeric(Number.POSITIVE_INFINITY)).toBeNull();
    expect(parseNumeric(Number.NEGATIVE_INFINITY)).toBeNull();
  });
});
