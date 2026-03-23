import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AlayaCareCache } from "./alayacare-cache";

describe("AlayaCareCache", () => {
  let cache: AlayaCareCache;

  beforeEach(() => {
    vi.useFakeTimers();
    cache = new AlayaCareCache(100); // 100ms TTL for fast tests
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("get / set", () => {
    it("should return null on cache miss", () => {
      expect(cache.get("missing")).toBeNull();
    });

    it("should return cached value on hit", () => {
      cache.set("key", { data: 42 });
      expect(cache.get("key")).toEqual({ data: 42 });
    });

    it("should return null after TTL expires", () => {
      cache.set("key", "value");
      vi.advanceTimersByTime(150);
      expect(cache.get("key")).toBeNull();
    });

    it("should support per-key TTL override", () => {
      cache.set("short", "value", 50);
      cache.set("long", "value", 500);
      vi.advanceTimersByTime(80);
      expect(cache.get("short")).toBeNull();
      expect(cache.get("long")).toBe("value");
    });
  });

  describe("getOrFetch", () => {
    it("should call fetcher on cache miss and cache result", async () => {
      const fetcher = vi.fn().mockResolvedValue({ items: [1, 2, 3] });

      const result = await cache.getOrFetch("key", fetcher);

      expect(result).toEqual({ items: [1, 2, 3] });
      expect(fetcher).toHaveBeenCalledOnce();

      // Second call should hit cache
      const result2 = await cache.getOrFetch("key", fetcher);
      expect(result2).toEqual({ items: [1, 2, 3] });
      expect(fetcher).toHaveBeenCalledOnce(); // still 1
    });

    it("should prevent stampede — concurrent callers share one fetch", async () => {
      let resolvePromise: (v: string) => void;
      const fetcher = vi.fn().mockReturnValue(
        new Promise<string>((resolve) => {
          resolvePromise = resolve;
        }),
      );

      // Start 3 concurrent requests
      const p1 = cache.getOrFetch("key", fetcher);
      const p2 = cache.getOrFetch("key", fetcher);
      const p3 = cache.getOrFetch("key", fetcher);

      // Fetcher called only once
      expect(fetcher).toHaveBeenCalledOnce();

      // Resolve the single fetch
      resolvePromise!("shared-result");

      const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
      expect(r1).toBe("shared-result");
      expect(r2).toBe("shared-result");
      expect(r3).toBe("shared-result");
    });

    it("should not cache failed fetches", async () => {
      const fetcher = vi
        .fn()
        .mockRejectedValueOnce(new Error("network"))
        .mockResolvedValueOnce("recovered");

      await expect(cache.getOrFetch("key", fetcher)).rejects.toThrow("network");

      // Retry should call fetcher again (not stuck on error)
      const result = await cache.getOrFetch("key", fetcher);
      expect(result).toBe("recovered");
      expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it("should return cached value without calling fetcher", async () => {
      cache.set("key", "pre-cached");
      const fetcher = vi.fn();

      const result = await cache.getOrFetch("key", fetcher);

      expect(result).toBe("pre-cached");
      expect(fetcher).not.toHaveBeenCalled();
    });
  });

  describe("invalidate / clear", () => {
    it("should remove specific key", () => {
      cache.set("a", 1);
      cache.set("b", 2);
      cache.invalidate("a");
      expect(cache.get("a")).toBeNull();
      expect(cache.get("b")).toBe(2);
    });

    it("should cancel in-flight fetch on invalidate so next caller starts fresh", async () => {
      vi.useRealTimers();
      let resolveFirst: (v: string) => void;
      const firstFetcher = vi.fn().mockReturnValue(
        new Promise<string>((resolve) => { resolveFirst = resolve; }),
      );
      const secondFetcher = vi.fn().mockResolvedValue("fresh-data");

      // Start an in-flight fetch
      const p1 = cache.getOrFetch("key", firstFetcher);

      // Invalidate while fetch is in-flight
      cache.invalidate("key");

      // New caller should NOT join the cancelled in-flight — should start fresh
      const p2 = cache.getOrFetch("key", secondFetcher);
      expect(secondFetcher).toHaveBeenCalledOnce();

      // Resolve the original (orphaned) fetch
      resolveFirst!("stale-data");
      await p1; // completes but result is orphaned

      const result = await p2;
      expect(result).toBe("fresh-data");
    });

    it("should remove all keys on clear", () => {
      cache.set("a", 1);
      cache.set("b", 2);
      cache.clear();
      expect(cache.size).toBe(0);
    });
  });
});
