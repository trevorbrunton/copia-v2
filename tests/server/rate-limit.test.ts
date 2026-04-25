/**
 * Tests for the in-memory sliding-window rate limiter that protects the
 * unauthenticated screen/Tavus routes from runaway spend.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _bucketCountForTests,
  _resetRateLimitForTests,
  _setMaxBucketsForTests,
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

  it("prunes events older than the longest window from the bucket", () => {
    // 1 / sec — a single event is allowed every second. After we wait
    // longer than the window, the bucket's events array should have
    // been trimmed (proven indirectly: we can fill the window again
    // without rejection, demonstrating the old event no longer counts).
    checkRateLimit("ip-a", ONE_PER_SEC);
    expect(() => checkRateLimit("ip-a", ONE_PER_SEC)).toThrow();

    // Walk well past the window so the prune branch on entry runs.
    vi.advanceTimersByTime(5_000);

    // Should be admitted, AND a follow-up should reject — confirming
    // we're tracking exactly one event again, not the stale one + a new one.
    expect(() => checkRateLimit("ip-a", ONE_PER_SEC)).not.toThrow();
    expect(() => checkRateLimit("ip-a", ONE_PER_SEC)).toThrow();
  });
});

describe("checkRateLimit — bucket sweep", () => {
  beforeEach(() => {
    _resetRateLimitForTests();
    _setMaxBucketsForTests(4); // small cap to make sweep observable
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  });

  afterEach(() => {
    _setMaxBucketsForTests();
    vi.useRealTimers();
  });

  it("evicts the oldest-touched buckets when the cap is hit", () => {
    // Fill four bucket slots with distinct lastSeen timestamps.
    checkRateLimit("ip-a", FIVE_PER_MIN);
    vi.advanceTimersByTime(100);
    checkRateLimit("ip-b", FIVE_PER_MIN);
    vi.advanceTimersByTime(100);
    checkRateLimit("ip-c", FIVE_PER_MIN);
    vi.advanceTimersByTime(100);
    checkRateLimit("ip-d", FIVE_PER_MIN);

    expect(_bucketCountForTests()).toBe(4);

    // Touching ip-b refreshes its lastSeen so it survives the upcoming sweep.
    vi.advanceTimersByTime(100);
    checkRateLimit("ip-b", FIVE_PER_MIN);

    // A fifth bucket triggers sweep (size >= cap when the new key is
    // inserted). Sweep drops floor(4/2) = 2 oldest-by-lastSeen buckets.
    // Order by lastSeen ascending: ip-a, ip-c, ip-d, ip-b → drop ip-a, ip-c.
    vi.advanceTimersByTime(100);
    checkRateLimit("ip-e", FIVE_PER_MIN);

    // ip-d, ip-b survive the sweep; ip-e is the new bucket. Three total.
    expect(_bucketCountForTests()).toBe(3);

    // Verify the survivors retain their event history (still tracked).
    // ip-d has 1 event; remaining capacity is 4 — should accept 4 more then reject.
    for (let i = 0; i < 4; i++) checkRateLimit("ip-d", FIVE_PER_MIN);
    expect(() => checkRateLimit("ip-d", FIVE_PER_MIN)).toThrow(TooManyRequestsError);
  });
});
