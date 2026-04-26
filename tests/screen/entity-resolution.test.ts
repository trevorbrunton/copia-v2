/**
 * Tests for the deterministic entity resolver.
 *
 * Uses a hand-crafted ticker/name set so the assertions are fast and
 * don't depend on the live snapshot.
 */
import { describe, expect, it } from "vitest";
import { resolveEntity } from "@/src/screen/entity-resolver";

const TEST_DATA = {
  tickers: new Set(["BHP", "CBA", "RIO", "MIN", "NXT", "ASX", "A2M", "WBC", "WES", "TLS"]),
  nameByTicker: new Map([
    ["BHP", "BHP GROUP LIMITED"],
    ["CBA", "COMMONWEALTH BANK OF AUSTRALIA"],
    ["RIO", "RIO TINTO LIMITED"],
    ["MIN", "MINERAL RESOURCES LIMITED"],
    ["NXT", "NEXTDC LIMITED"],
    ["ASX", "ASX LIMITED"],
    ["A2M", "THE A2 MILK COMPANY LIMITED"],
    ["WBC", "WESTPAC BANKING CORPORATION"],
    ["WES", "WESFARMERS LIMITED"],
    ["TLS", "TELSTRA GROUP LIMITED"],
  ]),
};

describe("resolveEntity — ticker pass", () => {
  it("matches an uppercase 3-letter ticker token", () => {
    expect(resolveEntity("What's BHP's market cap?", TEST_DATA)?.ticker).toBe("BHP");
  });

  it("matches a lowercase ticker token (case-insensitive)", () => {
    expect(resolveEntity("what's the price of cba", TEST_DATA)?.ticker).toBe("CBA");
  });

  it("matches mixed-case ticker tokens", () => {
    expect(resolveEntity("Tell me about Rio", TEST_DATA)?.ticker).toBe("RIO");
  });

  it("matches a 3-letter ticker with digits (A2M)", () => {
    expect(resolveEntity("What about A2M earnings?", TEST_DATA)?.ticker).toBe("A2M");
  });

  it("returns null when the ticker token doesn't match any known security", () => {
    expect(resolveEntity("Tell me about XYZ", TEST_DATA)).toBeNull();
  });

  it("returns null on ambiguous input (multiple ticker matches)", () => {
    // "ASX" and "BHP" are both valid tickers in the test set.
    expect(resolveEntity("Compare ASX vs BHP", TEST_DATA)).toBeNull();
  });

  it("ignores common English words that happen to share lengths", () => {
    // "WHAT", "THE", "FOR" — none are tickers in the test set.
    expect(resolveEntity("What can the screen do for me?", TEST_DATA)).toBeNull();
  });
});

describe("resolveEntity — company-name fallback", () => {
  it("matches via a distinctive name token (Commonwealth)", () => {
    expect(resolveEntity("commonwealth bank market cap", TEST_DATA)?.ticker).toBe("CBA");
  });

  it("matches via 'mineral resources'", () => {
    expect(resolveEntity("tell me about Mineral Resources", TEST_DATA)?.ticker).toBe("MIN");
  });

  it("matches via 'nextdc'", () => {
    expect(resolveEntity("what's the price of nextdc", TEST_DATA)?.ticker).toBe("NXT");
  });

  it("returns null when the name doesn't appear in the text", () => {
    expect(resolveEntity("Tell me about Acme Industries", TEST_DATA)).toBeNull();
  });

  it("prefers the ticker match over the name match when both could fire", () => {
    // The text contains "BHP" (ticker) and "limited" (which appears in
    // every company name). The ticker should win.
    const r = resolveEntity("BHP Limited", TEST_DATA);
    expect(r?.ticker).toBe("BHP");
  });
});

describe("resolveEntity — joined-tokens fallback (STT word splits)", () => {
  it("matches 'common wealth' as 'commonwealth' → CBA", () => {
    expect(resolveEntity("tell me about common wealth bank", TEST_DATA)?.ticker).toBe("CBA");
  });

  it("matches 'next dc' as 'nextdc' → NXT", () => {
    expect(resolveEntity("what's the price of next dc", TEST_DATA)?.ticker).toBe("NXT");
  });

  it("matches 'wes farmers' as 'wesfarmers' → WES", () => {
    expect(resolveEntity("tell me about wes farmers", TEST_DATA)?.ticker).toBe("WES");
  });
});

describe("resolveEntity — fuzzy single-token (typos / mispronunciations)", () => {
  it("matches 'westpack' (typo) → WBC", () => {
    expect(resolveEntity("tell me about westpack", TEST_DATA)?.ticker).toBe("WBC");
  });

  it("matches 'telestra' (mispronunciation) → TLS", () => {
    expect(resolveEntity("tell me about telestra", TEST_DATA)?.ticker).toBe("TLS");
  });

  it("matches 'wesfarmer' (missing trailing s) → WES", () => {
    expect(resolveEntity("how is wesfarmer doing", TEST_DATA)?.ticker).toBe("WES");
  });

  it("matches 'commonwelth' (single-letter drop) → CBA", () => {
    expect(resolveEntity("commonwelth bank price", TEST_DATA)?.ticker).toBe("CBA");
  });

  it("returns null when the typo is too far (>2 edits)", () => {
    // 'westxpyz' differs from 'westpac' by 4 edits — beyond the
    // FUZZY_MAX_DISTANCE = 2 threshold.
    expect(resolveEntity("tell me about westxpyz", TEST_DATA)).toBeNull();
  });
});

describe("resolveEntity — edge cases", () => {
  it("returns null for empty input", () => {
    expect(resolveEntity("", TEST_DATA)).toBeNull();
    expect(resolveEntity("   ", TEST_DATA)).toBeNull();
  });

  it("returns the resolved companyName alongside the ticker", () => {
    const r = resolveEntity("CBA price", TEST_DATA);
    expect(r).toEqual({ ticker: "CBA", companyName: "COMMONWEALTH BANK OF AUSTRALIA" });
  });
});
