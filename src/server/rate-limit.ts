/**
 * In-memory sliding-window rate limiter for unauthenticated routes that
 * spend money on third-party APIs (ElevenLabs, Anthropic, Tavus).
 *
 * **Scope and limits.** This is a single-process limiter — fine for one
 * Vercel/Node instance, leaky across horizontal scaling. The goal is to
 * cap obvious abuse from a single anonymous IP, not to be a complete
 * defence. For production-grade abuse control, swap the bucket store
 * for Redis or use Vercel's edge rate limiting.
 *
 * Each call is checked against every supplied window. The first window
 * that's full triggers a `TooManyRequestsError`. Surviving entries are
 * pruned by the longest window, so memory stays bounded.
 */
import { TooManyRequestsError } from "./errors";
import { logger } from "@/src/lib/logger";

export interface RateLimitWindow {
  /** Maximum events allowed within `windowMs`. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

interface Bucket {
  /** Sorted-newest-last timestamps of accepted events. */
  events: number[];
  /** Last time we touched this bucket — used for sweep. */
  lastSeen: number;
}

const buckets = new Map<string, Bucket>();

// Cap the bucket count so an attacker rotating IPs can't exhaust memory.
// When we hit the soft cap, drop buckets that haven't been touched within
// the longest window we've ever seen.
const MAX_BUCKETS = 10_000;

/**
 * Check a key against a list of windows. Throws `TooManyRequestsError`
 * with a `Retry-After` hint if any window is full; otherwise records
 * the event and returns. The caller should pass an IP-derived key.
 */
export function checkRateLimit(
  key: string,
  windows: readonly RateLimitWindow[]
): void {
  if (windows.length === 0) return;

  const now = Date.now();
  const longest = Math.max(...windows.map((w) => w.windowMs));

  let bucket = buckets.get(key);
  if (!bucket) {
    if (buckets.size >= MAX_BUCKETS) sweep(now);
    bucket = { events: [], lastSeen: now };
    buckets.set(key, bucket);
  }

  // Prune events older than the longest window — bound the array size.
  const cutoff = now - longest;
  if (bucket.events.length > 0 && bucket.events[0] <= cutoff) {
    bucket.events = bucket.events.filter((t) => t > cutoff);
  }
  bucket.lastSeen = now;

  for (const w of windows) {
    const wCutoff = now - w.windowMs;
    let count = 0;
    for (let i = bucket.events.length - 1; i >= 0; i--) {
      if (bucket.events[i] > wCutoff) count++;
      else break;
    }
    if (count >= w.limit) {
      const oldestInWindow = bucket.events.find((t) => t > wCutoff) ?? now;
      const retryAfterSec = Math.max(
        1,
        Math.ceil((oldestInWindow + w.windowMs - now) / 1000)
      );
      logger.warn(
        { key, limit: w.limit, windowMs: w.windowMs, count, retryAfterSec },
        "rate-limit:exceeded"
      );
      throw new TooManyRequestsError(
        `Rate limit exceeded: ${w.limit} requests per ${Math.round(w.windowMs / 1000)}s`,
        retryAfterSec
      );
    }
  }

  bucket.events.push(now);
}

/** Drop the oldest half of buckets when memory pressure hits. */
function sweep(now: number): void {
  const entries = Array.from(buckets.entries());
  entries.sort((a, b) => a[1].lastSeen - b[1].lastSeen);
  const toDrop = Math.floor(entries.length / 2);
  for (let i = 0; i < toDrop; i++) {
    buckets.delete(entries[i][0]);
  }
  logger.info(
    { dropped: toDrop, remaining: buckets.size, atMs: now },
    "rate-limit:sweep"
  );
}

/** Reset all buckets — for tests only. */
export function _resetRateLimitForTests(): void {
  buckets.clear();
}
