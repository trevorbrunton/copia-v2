/**
 * TTL cache for AlayaCare API data.
 *
 * Eliminates redundant API calls when multiple scoring requests arrive
 * in quick succession (e.g. 20 visit.vacated events from one employee quitting).
 *
 * Features:
 *  - Configurable TTL (default 30s)
 *  - Stampede prevention: concurrent requests for the same key share one in-flight fetch
 *  - Manual invalidation for webhook-driven cache busting
 */

import { logger } from "./logger";

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

export class AlayaCareCache {
  private entries = new Map<string, CacheEntry<unknown>>();
  private inflight = new Map<string, Promise<unknown>>();
  private readonly defaultTtlMs: number;

  constructor(ttlMs = 30_000) {
    this.defaultTtlMs = ttlMs;
  }

  /** Read from cache. Returns null on miss or expiry. */
  get<T>(key: string): T | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.entries.delete(key);
      return null;
    }
    return entry.data as T;
  }

  /** Write to cache with optional per-key TTL override. */
  set<T>(key: string, data: T, ttlMs?: number): void {
    this.entries.set(key, {
      data,
      expiresAt: Date.now() + (ttlMs ?? this.defaultTtlMs),
    });
  }

  /**
   * Get from cache or fetch. Prevents stampede: if a fetch for the same key
   * is already in flight, concurrent callers wait for it instead of starting
   * their own fetch.
   */
  async getOrFetch<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttlMs?: number,
  ): Promise<T> {
    // 1. Cache hit
    const cached = this.get<T>(key);
    if (cached !== null) {
      logger.debug({ key }, "alayacare-cache hit");
      return cached;
    }

    // 2. Stampede prevention — join in-flight request
    const pending = this.inflight.get(key);
    if (pending) {
      logger.debug({ key }, "alayacare-cache joining in-flight request");
      return pending as Promise<T>;
    }

    // 3. Cache miss — fetch, cache, clean up
    logger.debug({ key }, "alayacare-cache miss — fetching");
    const promise = fetcher()
      .then((data) => {
        this.set(key, data, ttlMs);
        this.inflight.delete(key);
        return data;
      })
      .catch((err) => {
        this.inflight.delete(key);
        throw err;
      });

    this.inflight.set(key, promise);
    return promise;
  }

  /** Remove a specific key (e.g. on employee.status_changed webhook). */
  invalidate(key: string): void {
    this.entries.delete(key);
    this.inflight.delete(key); // Cancel in-flight — next caller starts fresh
  }

  /** Drop everything (e.g. between test runs or on deploy). */
  clear(): void {
    this.entries.clear();
    this.inflight.clear();
  }

  /** Number of live (non-expired) entries. Useful for diagnostics. */
  get size(): number {
    return this.entries.size;
  }
}

// Module-level singleton — shared across all scoring calls within the process
export const alayaCareCache = new AlayaCareCache(30_000);

// Well-known cache keys
export const CACHE_KEY_EMPLOYEE_ROSTER = "employee-roster";
