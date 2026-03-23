# Chapter 5: Quotas & Rate Limiting

## Implementation Status

> **Not yet implemented.** This chapter is a design document for future work. It requires DynamoDB for rate limit counters, the usage metering pipeline (Chapter 4), and plan-based billing. No quotas or rate limiting code has been written.

## 5.1 Two Enforcement Layers

The system enforces limits at two independent layers:

| Layer | What it limits | Time window | Response |
|-------|---------------|-------------|----------|
| **Rate Limiting** | Requests per second/minute | Sliding window (1s, 1min) | `429 Too Many Requests` + `Retry-After` header |
| **Quota Enforcement** | Monthly/billing-period usage | Calendar month | `403 Quota Exceeded` + upgrade prompt |

Rate limiting prevents abuse and protects infrastructure. Quota enforcement ties usage to plan tiers and billing.

## 5.2 Plan Definitions

Plans are defined in code, not in the database. This makes them version-controlled, testable, and deterministic.

```typescript
// src/lib/plans/definitions.ts

export const PLANS = {
  free: {
    name: "Free",
    price: 0,
    limits: {
      members: 3,
      projects: 5,
      conversations: 20,
      aiTokensPerMonth: 50_000,
      apiCallsPerMonth: 10_000,
      storageBytes: 100 * 1024 * 1024,         // 100 MB
      concurrentSessions: 3,
    },
    rateLimits: {
      apiCallsPerMinute: 60,
      aiRequestsPerMinute: 5,
      aiRequestsPerDay: 50,
    },
    features: {
      chat: true,
      export: false,
      analytics: false,
      auditLog: false,
      customBranding: false,
    },
  },

  starter: {
    name: "Starter",
    price: 29,
    limits: {
      members: 10,
      projects: 50,
      conversations: 200,
      aiTokensPerMonth: 500_000,
      apiCallsPerMonth: 100_000,
      storageBytes: 1024 * 1024 * 1024,         // 1 GB
      concurrentSessions: 5,
    },
    rateLimits: {
      apiCallsPerMinute: 300,
      aiRequestsPerMinute: 20,
      aiRequestsPerDay: 500,
    },
    features: {
      chat: true,
      export: true,
      analytics: false,
      auditLog: false,
      customBranding: false,
    },
  },

  pro: {
    name: "Professional",
    price: 79,
    limits: {
      members: 50,
      projects: 500,
      conversations: 2000,
      aiTokensPerMonth: 5_000_000,
      apiCallsPerMonth: 1_000_000,
      storageBytes: 10 * 1024 * 1024 * 1024,    // 10 GB
      concurrentSessions: 10,
    },
    rateLimits: {
      apiCallsPerMinute: 1000,
      aiRequestsPerMinute: 60,
      aiRequestsPerDay: 2000,
    },
    features: {
      chat: true,
      export: true,
      analytics: true,
      auditLog: true,
      customBranding: false,
    },
  },

  enterprise: {
    name: "Enterprise",
    price: -1,  // Custom pricing
    limits: {
      members: -1,              // Unlimited
      projects: -1,
      conversations: -1,
      aiTokensPerMonth: -1,
      apiCallsPerMonth: -1,
      storageBytes: -1,
      concurrentSessions: 50,
    },
    rateLimits: {
      apiCallsPerMinute: 5000,
      aiRequestsPerMinute: 200,
      aiRequestsPerDay: -1,     // Unlimited
    },
    features: {
      chat: true,
      export: true,
      analytics: true,
      auditLog: true,
      customBranding: true,
    },
  },
} as const;

export type PlanId = keyof typeof PLANS;
export type PlanLimits = (typeof PLANS)[PlanId]["limits"];
export type PlanRateLimits = (typeof PLANS)[PlanId]["rateLimits"];
export type PlanFeatures = (typeof PLANS)[PlanId]["features"];

export function getPlan(planId: string): (typeof PLANS)[PlanId] {
  if (planId in PLANS) return PLANS[planId as PlanId];
  return PLANS.free;  // Default fallback
}

export function isUnlimited(value: number): boolean {
  return value === -1;
}
```

## 5.3 Rate Limiter

### Architecture

The rate limiter uses DynamoDB atomic counters with TTL for automatic cleanup. Each counter represents a time window (1-minute buckets).

```
Request arrives
    │
    ▼
┌────────────────────────────────────────────────────┐
│  DynamoDB: rate_limit_counters                     │
│                                                    │
│  PK: "RL#ORG#abc-123#apiCallsPerMinute"            │
│  SK: "WIN#2026-03-03T14:05"     (1-min window)     │
│  value: 247                                        │
│  ttl: 1709474760                (auto-expire)       │
│                                                    │
│  Atomic: UpdateItem ADD value 1                    │
│  Returns: new value (248)                          │
│                                                    │
│  248 < 300 (starter limit) → ALLOW                 │
│  248 ≥ 300                 → REJECT (429)           │
└────────────────────────────────────────────────────┘
```

### Implementation

```typescript
// src/lib/rate-limiter.ts

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  UpdateCommand,
  GetCommand,
} from "@aws-sdk/lib-dynamodb";
import { getPlan, isUnlimited, type PlanRateLimits } from "./plans/definitions";

const TABLE_NAME = process.env.RATE_LIMIT_TABLE || "myagency-rate-limits";

let docClient: DynamoDBDocumentClient | null = null;

function getDocClient() {
  if (!docClient) {
    const client = new DynamoDBClient({
      region: process.env.AWS_REGION || "ap-southeast-2",
    });
    docClient = DynamoDBDocumentClient.from(client);
  }
  return docClient;
}

interface RateLimitResult {
  allowed: boolean;
  current: number;
  limit: number;
  retryAfterSeconds?: number;
  windowKey: string;
}

/**
 * Check and increment a rate limit counter.
 * Returns whether the request is allowed.
 *
 * Uses DynamoDB atomic ADD to guarantee correctness under concurrency.
 */
export async function checkRateLimit(
  orgId: string,
  limitName: keyof PlanRateLimits,
  plan: string,
  windowSizeMinutes: number = 1
): Promise<RateLimitResult> {
  const planDef = getPlan(plan);
  const limit = planDef.rateLimits[limitName] as number;

  // Unlimited → always allow
  if (isUnlimited(limit)) {
    return { allowed: true, current: 0, limit: -1, windowKey: "" };
  }

  const now = new Date();
  const windowKey = getWindowKey(now, windowSizeMinutes);
  const pk = `RL#ORG#${orgId}#${limitName}`;
  const sk = `WIN#${windowKey}`;

  // TTL: expire 2 minutes after window ends
  const ttl = Math.floor(now.getTime() / 1000) + (windowSizeMinutes + 2) * 60;

  try {
    const result = await getDocClient().send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { PK: pk, SK: sk },
        UpdateExpression: "ADD #val :inc SET #ttl = if_not_exists(#ttl, :ttl)",
        ExpressionAttributeNames: {
          "#val": "value",
          "#ttl": "ttl",
        },
        ExpressionAttributeValues: {
          ":inc": 1,
          ":ttl": ttl,
        },
        ReturnValues: "ALL_NEW",
      })
    );

    const current = result.Attributes?.value ?? 1;
    const allowed = current <= limit;

    return {
      allowed,
      current,
      limit,
      retryAfterSeconds: allowed ? undefined : getSecondsUntilNextWindow(now, windowSizeMinutes),
      windowKey,
    };
  } catch (error) {
    // Rate limiter failure should not block requests
    console.error("Rate limit check failed:", error);
    return { allowed: true, current: 0, limit, windowKey: "" };
  }
}

/**
 * Check a daily rate limit (e.g., aiRequestsPerDay).
 */
export async function checkDailyRateLimit(
  orgId: string,
  limitName: keyof PlanRateLimits,
  plan: string
): Promise<RateLimitResult> {
  return checkRateLimit(orgId, limitName, plan, 24 * 60);
}

function getWindowKey(date: Date, windowSizeMinutes: number): string {
  if (windowSizeMinutes >= 24 * 60) {
    // Daily window
    return date.toISOString().split("T")[0]; // "2026-03-03"
  }
  // Minute-level window
  const minutes = date.getMinutes();
  const windowStart = Math.floor(minutes / windowSizeMinutes) * windowSizeMinutes;
  const d = new Date(date);
  d.setMinutes(windowStart, 0, 0);
  return d.toISOString().slice(0, 16); // "2026-03-03T14:05"
}

function getSecondsUntilNextWindow(now: Date, windowSizeMinutes: number): number {
  const currentMinute = now.getMinutes();
  const windowStart = Math.floor(currentMinute / windowSizeMinutes) * windowSizeMinutes;
  const windowEnd = windowStart + windowSizeMinutes;
  const secondsIntoWindow = (currentMinute - windowStart) * 60 + now.getSeconds();
  return windowSizeMinutes * 60 - secondsIntoWindow;
}
```

## 5.4 Quota Enforcement

Monthly quotas check the aggregated counters (from Chapter 4) against plan limits.

```typescript
// src/lib/quota-enforcer.ts

import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { getPlan, isUnlimited, type PlanLimits } from "./plans/definitions";

const COUNTER_TABLE = process.env.USAGE_COUNTER_TABLE || "myagency-usage-counters";

interface QuotaCheckResult {
  allowed: boolean;
  current: number;
  limit: number;
  percentUsed: number;
  overage: number;
}

/**
 * Check if a monthly quota allows the requested increment.
 * Also atomically increments the counter if allowed.
 */
export async function checkAndIncrementQuota(
  orgId: string,
  quotaName: keyof PlanLimits,
  plan: string,
  increment: number = 1
): Promise<QuotaCheckResult> {
  const planDef = getPlan(plan);
  const limit = planDef.limits[quotaName] as number;

  if (isUnlimited(limit)) {
    return { allowed: true, current: 0, limit: -1, percentUsed: 0, overage: 0 };
  }

  const monthKey = getCurrentMonthKey();
  const pk = `ORG#${orgId}#${monthKey}`;
  const sk = quotaName;

  // Read current value
  const current = await getCurrentCounter(pk, sk);

  if (current + increment > limit) {
    return {
      allowed: false,
      current,
      limit,
      percentUsed: Math.round((current / limit) * 100),
      overage: current + increment - limit,
    };
  }

  // Increment atomically
  await incrementCounter(pk, sk, increment);

  return {
    allowed: true,
    current: current + increment,
    limit,
    percentUsed: Math.round(((current + increment) / limit) * 100),
    overage: 0,
  };
}

/**
 * Check quota without incrementing. Used for UI display.
 */
export async function getQuotaStatus(
  orgId: string,
  quotaName: keyof PlanLimits,
  plan: string
): Promise<QuotaCheckResult> {
  const planDef = getPlan(plan);
  const limit = planDef.limits[quotaName] as number;

  if (isUnlimited(limit)) {
    return { allowed: true, current: 0, limit: -1, percentUsed: 0, overage: 0 };
  }

  const monthKey = getCurrentMonthKey();
  const pk = `ORG#${orgId}#${monthKey}`;
  const current = await getCurrentCounter(pk, quotaName);

  return {
    allowed: current < limit,
    current,
    limit,
    percentUsed: Math.round((current / limit) * 100),
    overage: Math.max(0, current - limit),
  };
}

/**
 * Get all quota statuses for an org in one call.
 */
export async function getAllQuotaStatuses(
  orgId: string,
  plan: string
): Promise<Record<string, QuotaCheckResult>> {
  const quotaNames: (keyof PlanLimits)[] = [
    "members",
    "projects",
    "conversations",
    "aiTokensPerMonth",
    "apiCallsPerMonth",
    "storageBytes",
  ];

  const results: Record<string, QuotaCheckResult> = {};

  // Parallel reads
  await Promise.all(
    quotaNames.map(async (name) => {
      results[name] = await getQuotaStatus(orgId, name, plan);
    })
  );

  return results;
}

function getCurrentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

async function getCurrentCounter(pk: string, sk: string): Promise<number> {
  try {
    const result = await getDocClient().send(
      new GetCommand({
        TableName: COUNTER_TABLE,
        Key: { PK: pk, SK: sk },
      })
    );
    return result.Item?.value ?? 0;
  } catch {
    return 0;
  }
}

async function incrementCounter(pk: string, sk: string, increment: number) {
  const now = new Date();
  // TTL: 90 days after end of month
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const ttl = Math.floor(endOfMonth.getTime() / 1000) + 90 * 24 * 60 * 60;

  await getDocClient().send(
    new UpdateCommand({
      TableName: COUNTER_TABLE,
      Key: { PK: pk, SK: sk },
      UpdateExpression: "ADD #val :inc SET #ttl = if_not_exists(#ttl, :ttl)",
      ExpressionAttributeNames: { "#val": "value", "#ttl": "ttl" },
      ExpressionAttributeValues: { ":inc": increment, ":ttl": ttl },
    })
  );
}
```

## 5.5 Integration with secureHandler

Rate limiting and quota checks insert into the `secureHandler` pipeline before the handler executes:

```typescript
// In secureHandler, after permission check (step 5):

// 4a. Rate limit check
const rateLimitResult = await checkRateLimit(
  orgId,
  "apiCallsPerMinute",
  org.plan
);

if (!rateLimitResult.allowed) {
  return new NextResponse(
    JSON.stringify({
      error: "Rate limit exceeded",
      current: rateLimitResult.current,
      limit: rateLimitResult.limit,
      retryAfter: rateLimitResult.retryAfterSeconds,
    }),
    {
      status: 429,
      headers: {
        "Retry-After": String(rateLimitResult.retryAfterSeconds),
        "X-RateLimit-Limit": String(rateLimitResult.limit),
        "X-RateLimit-Remaining": String(
          Math.max(0, rateLimitResult.limit - rateLimitResult.current)
        ),
        "X-RateLimit-Reset": String(rateLimitResult.retryAfterSeconds),
      },
    }
  );
}
```

For AI-specific endpoints, add an additional AI rate limit check:

```typescript
// In POST /api/chat/stream handler:

// Check AI-specific rate limits
const aiMinuteLimit = await checkRateLimit(orgId, "aiRequestsPerMinute", org.plan);
if (!aiMinuteLimit.allowed) {
  return tooManyRequests("AI rate limit exceeded", aiMinuteLimit.retryAfterSeconds);
}

const aiDailyLimit = await checkDailyRateLimit(orgId, "aiRequestsPerDay", org.plan);
if (!aiDailyLimit.allowed) {
  return tooManyRequests("Daily AI request limit reached");
}

// Check monthly token quota
const tokenQuota = await getQuotaStatus(orgId, "aiTokensPerMonth", org.plan);
if (!tokenQuota.allowed) {
  return forbidden("Monthly AI token quota exceeded", {
    code: "QUOTA_EXCEEDED",
    quota: "aiTokensPerMonth",
    current: tokenQuota.current,
    limit: tokenQuota.limit,
  });
}
```

## 5.6 Quota Warning Thresholds

The system sends notifications at configurable usage thresholds:

```typescript
// src/lib/plans/thresholds.ts

export const QUOTA_THRESHOLDS = [
  { percent: 50,  severity: "info",    notify: false },
  { percent: 75,  severity: "warning", notify: true  },
  { percent: 90,  severity: "danger",  notify: true  },
  { percent: 100, severity: "blocked", notify: true  },
] as const;

export function getThresholdStatus(percentUsed: number) {
  // Find the highest threshold that has been reached
  const reached = QUOTA_THRESHOLDS
    .filter((t) => percentUsed >= t.percent)
    .pop();

  return reached ?? { percent: 0, severity: "ok" as const, notify: false };
}
```

### Notification Triggers

When a threshold with `notify: true` is crossed for the first time in a billing period:

1. **In-app banner** — displayed on every page until acknowledged
2. **Email to org owner** — "Your organization has used 75% of its monthly AI token quota"
3. **Webhook** (enterprise) — POST to configured URL

```sql
-- Tracking which thresholds have been notified this period
CREATE TABLE quota_notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id),
  quota_name  TEXT NOT NULL,
  threshold   INTEGER NOT NULL,
  period      TEXT NOT NULL,              -- "2026-03"
  notified_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE (org_id, quota_name, threshold, period)
);
```

## 5.7 Grace Periods & Overage Policies

Rather than hard-blocking at exactly 100%, the system supports configurable overage behavior:

```typescript
// src/lib/plans/overage.ts

interface OveragePolicy {
  /** Allow usage up to this % beyond the limit before hard-blocking */
  softLimitPercent: number;
  /** Charge per unit of overage (0 = no overage billing) */
  overageRate: number;
  /** Grace period in hours after hitting limit before enforcement */
  graceHours: number;
}

const OVERAGE_POLICIES: Record<string, OveragePolicy> = {
  free: {
    softLimitPercent: 0,       // Hard block at 100%
    overageRate: 0,
    graceHours: 0,
  },
  starter: {
    softLimitPercent: 10,      // Allow 10% overage
    overageRate: 0,            // No extra charge (included in grace)
    graceHours: 24,            // 24-hour grace period
  },
  pro: {
    softLimitPercent: 20,      // Allow 20% overage
    overageRate: 0.002,        // $0.002 per extra 1K tokens
    graceHours: 72,            // 72-hour grace period
  },
  enterprise: {
    softLimitPercent: 100,     // Effectively unlimited overage
    overageRate: 0.001,        // Negotiated rate
    graceHours: 720,           // 30-day grace (end of billing cycle)
  },
};
```

## 5.8 Resource Count Limits

Some limits are not rate-based but count-based (e.g., max members, max projects). These are checked at creation time against database counts.

```typescript
// src/lib/quota-enforcer.ts (addition)

export async function checkResourceCount(
  tx: TransactionClient,
  orgId: string,
  resource: "members" | "projects" | "conversations",
  plan: string
): Promise<{ allowed: boolean; current: number; limit: number }> {
  const planDef = getPlan(plan);
  const limit = planDef.limits[resource] as number;

  if (isUnlimited(limit)) {
    return { allowed: true, current: 0, limit: -1 };
  }

  let count: number;

  switch (resource) {
    case "members":
      [{ count }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(orgMemberships)
        .where(eq(orgMemberships.orgId, orgId));
      break;
    case "projects":
      [{ count }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(projects)
        .where(eq(projects.orgId, orgId));
      break;
    case "conversations":
      [{ count }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(chatConversations)
        .where(eq(chatConversations.orgId, orgId));
      break;
  }

  return {
    allowed: count < limit,
    current: count,
    limit,
  };
}
```

## 5.9 API Routes

```
app/api/orgs/[orgId]/
├── quotas/
│   ├── route.ts                # GET — all quota statuses
│   └── [quotaName]/route.ts    # GET — specific quota status
└── plan/
    └── route.ts                # GET — current plan, PATCH — upgrade/downgrade
```

## 5.10 Client-Side Hooks

```typescript
// src/hooks/use-quotas.ts

"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/src/lib/api-client";

export function useQuotas() {
  return useQuery({
    queryKey: ["quotas"],
    queryFn: async () => {
      const res = await apiFetch("/api/orgs/current/quotas");
      if (!res.ok) throw new Error("Failed to fetch quotas");
      return res.json();
    },
    refetchInterval: 60_000,  // Refresh every minute
  });
}

export function useQuotaWarning() {
  const { data: quotas } = useQuotas();

  if (!quotas) return null;

  // Find the most critical quota
  const critical = Object.entries(quotas)
    .filter(([, q]: [string, any]) => q.percentUsed >= 75)
    .sort(([, a]: [string, any], [, b]: [string, any]) => b.percentUsed - a.percentUsed)
    .map(([name, q]: [string, any]) => ({ name, ...q }));

  return critical.length > 0 ? critical[0] : null;
}
```

## 5.11 Rate Limit Headers

Every API response includes rate limit headers so clients can implement client-side throttling:

```
X-RateLimit-Limit: 300            # Requests allowed per window
X-RateLimit-Remaining: 247        # Requests remaining in current window
X-RateLimit-Reset: 42             # Seconds until window resets
X-Quota-AiTokens-Limit: 500000   # Monthly token limit
X-Quota-AiTokens-Used: 127500    # Tokens used this month
X-Quota-AiTokens-Remaining: 372500
```
