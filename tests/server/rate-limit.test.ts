/**
 * Tests for the in-memory sliding-window rate limiter that protects the
 * unauthenticated screen/Tavus routes from runaway spend.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetRateLimitForTests,
  checkRateLimit,
  type RateLimitWindow,
} from "@/src/server/rate-limit";
import { TooManyRequestsError } from "@/src/server/errors";

const ONE_PER_SEC: RateLimitWindow[] = [{ limit: 1, windowMs: 1000 }];
const FIVE_PER_MIN: RateLimitWindow[] = [{ limit: 5, windowMs: 60_000 }];

describe("checkRateLimit", () => {
  beforeEach(() => {
    _resetRateLimitForTests();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows the first call up to the limit", () => {
    expect(() => checkRateLimit("ip-a", FIVE_PER_MIN)).not.toThrow();
    expect(() => checkRateLimit("ip-a", FIVE_PER_MIN)).not.toThrow();
    expect(() => checkRateLimit("ip-a", FIVE_PER_MIN)).not.toThrow();
    expect(() => checkRateLimit("ip-a", FIVE_PER_MIN)).not.toThrow();
    expect(() => checkRateLimit("ip-a", FIVE_PER_MIN)).not.toThrow();
  });

  it("rejects the call that exceeds the limit", () => {
    for (let i = 0; i < 5; i++) checkRateLimit("ip-a", FIVE_PER_MIN);
    expect(() => checkRateLimit("ip-a", FIVE_PER_MIN)).toThrow(TooManyRequestsError);
  });

  it("isolates buckets by key — different IPs don't collide", () => {
    checkRateLimit("ip-a", ONE_PER_SEC);
    expect(() => checkRateLimit("ip-a", ONE_PER_SEC)).toThrow(TooManyRequestsError);
    expect(() => checkRateLimit("ip-b", ONE_PER_SEC)).not.toThrow();
  });

  it("releases capacity once the window slides past old events", () => {
    checkRateLimit("ip-a", ONE_PER_SEC);
    expect(() => checkRateLimit("ip-a", ONE_PER_SEC)).toThrow();

    vi.advanceTimersByTime(1100);
    expect(() => checkRateLimit("ip-a", ONE_PER_SEC)).not.toThrow();
  });

  it("populates a Retry-After hint on the thrown error", () => {
    checkRateLimit("ip-a", ONE_PER_SEC);
    try {
      checkRateLimit("ip-a", ONE_PER_SEC);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(TooManyRequestsError);
      const r = (err as TooManyRequestsError).retryAfterSec;
      expect(r).toBeDefined();
      expect(r! >= 1 && r! <= 1).toBe(true);
    }
  });

  it("enforces the most restrictive of multiple windows", () => {
    // 3 / 10s AND 100 / hour — burst limit kicks in first.
    const windows: RateLimitWindow[] = [
      { limit: 3, windowMs: 10_000 },
      { limit: 100, windowMs: 60 * 60_000 },
    ];
    for (let i = 0; i < 3; i++) checkRateLimit("ip-a", windows);
    expect(() => checkRateLimit("ip-a", windows)).toThrow(TooManyRequestsError);

    // After 11s the short window has cleared, but the hour window has
    // 3 events still recorded — should accept again.
    vi.advanceTimersByTime(11_000);
    expect(() => checkRateLimit("ip-a", windows)).not.toThrow();
  });

  it("treats an empty windows list as a no-op (defence-in-depth)", () => {
    expect(() => checkRateLimit("ip-a", [])).not.toThrow();
    // Subsequent real check shouldn't have been polluted.
    expect(() => checkRateLimit("ip-a", FIVE_PER_MIN)).not.toThrow();
  });
});
