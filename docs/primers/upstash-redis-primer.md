# Upstash Redis — Primer

## What It Is

Upstash Redis is a **serverless, HTTP-based Redis service**. Redis itself is an in-memory data store used for caching, rate limiting, distributed locks, and fast key-value lookups. Upstash wraps Redis in a managed cloud service with one critical difference from traditional Redis: **every command is a stateless HTTP request** rather than a persistent TCP connection.

You provision a database via the Upstash console, receive a REST URL and auth token, and start issuing commands. There is no server to manage, no scaling to configure, and no idle infrastructure burning money.

---

## How Traditional Redis Works (and Why It's Problematic for Serverless)

Traditional Redis (self-hosted, AWS ElastiCache, Redis Cloud) uses **TCP connections**. A client opens a long-lived socket to the Redis server and sends commands over that connection. This works well for always-on servers but creates problems in serverless environments:

- **Cold starts**: Serverless functions start and stop constantly, creating and destroying connections each time.
- **Connection limits**: Redis servers have finite connection slots. Hundreds of concurrent serverless function invocations can exhaust them.
- **Edge runtimes**: Vercel Edge Functions, Cloudflare Workers, and Deno Deploy do not support TCP connections at all — only HTTP.
- **Connection pooling**: Impossible when each function invocation is stateless and isolated.

## How Upstash Redis Works

Upstash exposes Redis through an **HTTP REST API**. The `@upstash/redis` SDK wraps this in a familiar interface:

```typescript
import { Redis } from "@upstash/redis";
const redis = Redis.fromEnv(); // reads URL + token from env vars

await redis.set("key", "value", { ex: 30 }); // SET with 30-second TTL
const val = await redis.get("key");           // GET
await redis.del("key");                       // DELETE
```

Each call is an independent HTTP request. No connection setup, no teardown, no pool management. `Redis.fromEnv()` reads `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` from environment variables — that's the entire configuration.

The SDK supports all standard Redis data types (strings, lists, sets, sorted sets, hashes), TTL expiration, pipeline batching (multiple commands in one HTTP request), and transactions (MULTI/EXEC).

---

## Key Features

### Serverless and Edge Native

Works everywhere HTTP works:

| Runtime | TCP Redis | Upstash Redis |
|---------|-----------|---------------|
| Vercel Serverless Functions | Works but connection issues | Works natively |
| Vercel Edge Functions | Not supported (no TCP) | Works natively |
| Cloudflare Workers | Not supported (no TCP) | Works natively |
| AWS Lambda | Works but pool exhaustion risk | Works natively |

### Persistence by Default

Every write is **persisted to disk** (block storage). This is always on — not optional. Data survives restarts and node failures. Traditional Redis treats persistence as optional (RDB snapshots or AOF logs), and many configurations run purely in memory.

### Per-Request Pricing

| Tier | Cost | Includes |
|------|------|----------|
| Free | $0 | 500K commands/month, 256MB storage |
| Pay-as-you-go | $0.20 per 100K commands | Scales with usage |
| Pro (fixed) | From $10/month | Predictable billing |

Compared to **AWS ElastiCache**: the smallest ElastiCache node costs $13–100+/month regardless of traffic. For low-to-moderate usage (under ~5M commands/month), Upstash is dramatically cheaper.

### Regional Deployment

Available in major cloud regions including `ap-southeast-2` (Sydney), which aligns with Australian data residency requirements.

---

## How We Use It in This App

### 1. Rate Limiting (6 limiters)

Using the companion `@upstash/ratelimit` SDK, which builds pre-made rate limiting algorithms on top of Redis:

```typescript
import { Ratelimit } from "@upstash/ratelimit";

export const apiLimiter = new Ratelimit({
  redis, limiter: Ratelimit.slidingWindow(120, "1 m"), prefix: "rl:api",
});
```

| Limiter | Algorithm | Limit | Purpose |
|---------|-----------|-------|---------|
| `apiLimiter` | Sliding window | 120/min | Per-user API rate limiting |
| `loginLimiter` | Sliding window | 5/15min | Brute-force login protection |
| `webhookLimiter` | Token bucket | 100/s, burst 200 | AlayaCare webhook ingress throttling |
| `bedrockLimiter` | Fixed window | 20/min | AWS Bedrock LLM quota management |
| `alayacareLimiter` | Sliding window | 50/min | Outbound AlayaCare API protection |
| `xanoLimiter` | Sliding window | 200/min | Xano API protection during workflow bursts |

**Why not in-memory rate limiting?** In-memory counters are local to a single serverless function instance. If Vercel spins up 10 instances, each has its own counter — the effective rate limit is 10× what you intended. Redis rate limiting is shared across all instances.

### 2. Employee Roster Caching

The scoring engine needs the full employee roster (150+ employees with skills). Fetching this from Xano on every scoring run would be slow and expensive. Instead:

```typescript
export async function getCachedEmployeeRoster(xano, userId) {
  const key = `cache:employee-roster:${userId}`;
  const cached = await redis.get(key);
  if (cached) return cached;
  const roster = await xano.get("/employees/roster");
  await redis.set(key, roster, { ex: 30 }); // 30-second TTL
  return roster;
}
```

- **30-second TTL**: Fresh enough for scoring accuracy, long enough to batch multiple scoring runs.
- **Tenant-scoped**: Cache key includes `userId` for future multi-tenant support.
- **Explicit invalidation**: When an employee's status changes or unavailability is updated (via webhook), the cache is cleared immediately: `await redis.del("cache:employee-roster:${userId}")`.

**Why not in-memory caching?** Same problem as rate limiting — in-memory caches are per-instance and lost on function recycle. The current codebase uses an in-memory `AlayaCareCache` class that doesn't work across multiple serverless instances. Redis provides shared, durable caching.

### 3. Distributed Scoring Lock

Prevents duplicate workflows from scoring the same visit concurrently:

```typescript
export async function acquireScoringLock(visitId) {
  return (await redis.set(`lock:scoring:${visitId}`, "1", { ex: 30, nx: true })) === "OK";
}
```

This uses Redis `SET NX` (set-if-not-exists) — a standard distributed lock primitive:
- If the key doesn't exist, it's created and the lock is acquired → returns `"OK"`.
- If the key already exists (another workflow got there first), nothing happens → returns `null`.
- The 30-second TTL auto-releases the lock if the workflow crashes.

This is one layer of a three-layer deduplication strategy:
1. QStash `deduplicationId` (24-hour window at webhook ingress)
2. **Redis scoring lock** (30-second window at workflow start)
3. Xano unique partial index on `(visit_id, user_id)` (permanent, at database level)

### 4. Cache Invalidation on Webhook Events

When employee data changes via AlayaCare webhooks, the event handler clears the cached roster:

```typescript
// In employee.status_changed and employee.unavailability handlers:
await redis.del(`cache:employee-roster:${userId}`);
```

This ensures the scoring engine always works with fresh data after employee changes.

---

## Why Upstash Redis Is the Right Choice

| Requirement | Why Upstash Fits |
|-------------|-----------------|
| **Vercel serverless deployment** | HTTP-based — no TCP connections, no pool management, no cold-start issues |
| **Shared state across instances** | All serverless function instances share the same Redis, unlike in-memory state |
| **Edge compatibility** | Works in Edge Functions if we move rate limiting to the edge |
| **Low cost at current scale** | ~100 tasks/day stays well within the free tier ($0/month) |
| **Australian data residency** | Available in Sydney (`ap-southeast-2`) |
| **No vendor lock-in** | Uses standard Redis primitives (`SET`, `GET`, `DEL`, `SET NX`). Any Redis provider can replace Upstash — ElastiCache, Railway Redis, Dragonfly, etc. |
| **Unified platform** | Same Upstash account for Redis, QStash, and Workflow — single billing, single dashboard |

---

## Environment Variables

```bash
UPSTASH_REDIS_REST_URL=     # Redis endpoint URL
UPSTASH_REDIS_REST_TOKEN=   # Authentication token
```

Both consumed by `Redis.fromEnv()` — no other configuration needed.
