# Chapter 4: Usage Tracking & Metering

## Implementation Status

> **Not yet implemented.** This chapter is a design document for future work. It requires DynamoDB, Kinesis, and Lambda infrastructure (Chapter 9) plus the RBAC/org model. No usage metering code has been written.

## 4.1 What Gets Metered

Every measurable action in the system falls into one of five metering categories:

| Category | What is counted | Unit | Example |
|----------|----------------|------|---------|
| **API Calls** | Every authenticated API request | requests | `GET /api/projects`, `POST /api/chat/stream` |
| **AI Tokens** | Input and output tokens consumed by Bedrock | tokens | 450 input + 1200 output = 1650 tokens |
| **Storage** | Total data stored per org | bytes | Projects, conversations, messages, attachments |
| **Compute** | SSE stream duration | seconds | A 45-second AI chat stream |
| **Feature Usage** | Discrete feature interactions | events | "Used project search", "Changed theme", "Exported data" |

## 4.2 Event Schema

Every usage event conforms to a single schema. Events are append-only and immutable.

```typescript
// src/lib/usage/types.ts

interface UsageEvent {
  // Identity
  orgId: string;
  userId: string;
  sessionId?: string;

  // What happened
  category: "api_call" | "ai_tokens" | "storage" | "compute" | "feature";
  action: string;              // "projects:create", "chat:stream", "export:csv"
  resource?: string;           // "project", "conversation", "message"
  resourceId?: string;

  // Measurements
  count: number;               // 1 for single events, N for batch
  tokensIn?: number;           // AI input tokens
  tokensOut?: number;          // AI output tokens
  bytes?: number;              // Storage delta (positive = added, negative = removed)
  durationMs?: number;         // Compute time

  // Context
  method?: string;             // HTTP method
  path?: string;               // API path
  statusCode?: number;         // Response status
  deviceType?: string;         // "web", "ios", "android"
  ipAddress?: string;

  // Timestamp
  timestamp: string;           // ISO 8601
}
```

## 4.3 Event Collection Architecture

Events are collected at the API layer and funneled into a high-throughput append store. The design separates the hot write path from the analytical read path.

```
                    secureHandler()
                         │
                         │ (after handler executes)
                         ▼
                 ┌───────────────┐
                 │ UsageEmitter  │  Non-blocking, fire-and-forget
                 │               │
                 │ Batches events│
                 │ in memory     │
                 │ (100ms window)│
                 └───────┬───────┘
                         │
              ┌──────────┴──────────┐
              │                     │
              ▼                     ▼
    ┌──────────────────┐  ┌──────────────────┐
    │   Kinesis Data    │  │  DynamoDB Direct  │
    │   Stream          │  │  (fallback)       │
    │                   │  │                   │
    │  High throughput  │  │  Lower throughput │
    │  Ordered          │  │  but simpler      │
    └────────┬──────────┘  └──────────────────┘
             │
             ▼
    ┌──────────────────┐
    │  Lambda Consumer  │
    │                   │
    │  Batch writes to  │
    │  DynamoDB         │
    │  (25 items/batch) │
    └────────┬──────────┘
             │
             ▼
    ┌──────────────────┐
    │    DynamoDB       │
    │    usage_events   │
    │                   │
    │  PK: ORG#orgId    │
    │  SK: TS#ts#type   │
    │                   │
    │  TTL: 90 days     │
    └────────┬──────────┘
             │
             │  Lambda (scheduled, every 5 min)
             ▼
    ┌──────────────────┐
    │    Aurora         │
    │    (aggregated)   │
    │                   │
    │  usage_hourly     │
    │  usage_daily      │
    │  usage_monthly    │
    └──────────────────┘
```

### Decision: Why DynamoDB for Raw Events?

| Consideration | Aurora | DynamoDB |
|---------------|--------|----------|
| Write throughput | ~1000 TPS (Aurora Serverless v2 at 4 ACU) | 40,000+ WCU on-demand |
| Cost per million writes | ~$4.00 (based on ACU-hours) | ~$1.25 (on-demand) |
| TTL (auto-delete old events) | Manual cron job | Built-in TTL |
| Impact on app queries | Shares capacity with RLS queries | Isolated |
| Schema flexibility | Rigid | Schemaless |

Raw events go to DynamoDB. Aggregated rollups go to Aurora (where they're queried by the analytics dashboard).

## 4.4 Usage Emitter

The emitter is a lightweight, non-blocking module that collects events and sends them to the ingestion pipeline.

```typescript
// src/lib/usage/emitter.ts

import { KinesisClient, PutRecordsCommand } from "@aws-sdk/client-kinesis";
import type { UsageEvent } from "./types";

const STREAM_NAME = process.env.USAGE_KINESIS_STREAM || "myagency-usage-events";
const BATCH_WINDOW_MS = 100;     // Batch events for 100ms before flushing
const MAX_BATCH_SIZE = 50;

let kinesis: KinesisClient | null = null;
let eventBuffer: UsageEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function getKinesis() {
  if (!kinesis) {
    kinesis = new KinesisClient({
      region: process.env.AWS_REGION || "ap-southeast-2",
    });
  }
  return kinesis;
}

/**
 * Emit a usage event. Non-blocking — events are buffered and flushed
 * in batches. Failures are logged but never block the request.
 */
export function emitUsageEvent(event: UsageEvent) {
  eventBuffer.push({
    ...event,
    timestamp: event.timestamp || new Date().toISOString(),
  });

  if (eventBuffer.length >= MAX_BATCH_SIZE) {
    flushEvents();
  } else if (!flushTimer) {
    flushTimer = setTimeout(flushEvents, BATCH_WINDOW_MS);
  }
}

async function flushEvents() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }

  if (eventBuffer.length === 0) return;

  const batch = eventBuffer.splice(0, MAX_BATCH_SIZE);

  try {
    await getKinesis().send(
      new PutRecordsCommand({
        StreamName: STREAM_NAME,
        Records: batch.map((event) => ({
          Data: Buffer.from(JSON.stringify(event)),
          PartitionKey: event.orgId, // Ensures per-org ordering
        })),
      })
    );
  } catch (error) {
    // Log but never throw — usage tracking must not block requests
    console.error("Failed to emit usage events:", error);
    // Could fall back to DynamoDB direct write here
  }
}

// ── Convenience emitters for common event types ──────

export function emitApiCall(params: {
  orgId: string;
  userId: string;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  deviceType?: string;
  ipAddress?: string;
}) {
  emitUsageEvent({
    orgId: params.orgId,
    userId: params.userId,
    category: "api_call",
    action: `${params.method} ${params.path}`,
    method: params.method,
    path: params.path,
    statusCode: params.statusCode,
    durationMs: params.durationMs,
    count: 1,
    deviceType: params.deviceType,
    ipAddress: params.ipAddress,
    timestamp: new Date().toISOString(),
  });
}

export function emitAiTokens(params: {
  orgId: string;
  userId: string;
  conversationId: string;
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
  model: string;
}) {
  emitUsageEvent({
    orgId: params.orgId,
    userId: params.userId,
    category: "ai_tokens",
    action: "chat:stream",
    resource: "conversation",
    resourceId: params.conversationId,
    count: 1,
    tokensIn: params.tokensIn,
    tokensOut: params.tokensOut,
    durationMs: params.durationMs,
    timestamp: new Date().toISOString(),
  });
}

export function emitStorageChange(params: {
  orgId: string;
  userId: string;
  resource: string;
  resourceId: string;
  byteDelta: number;
}) {
  emitUsageEvent({
    orgId: params.orgId,
    userId: params.userId,
    category: "storage",
    action: params.byteDelta > 0 ? "storage:add" : "storage:remove",
    resource: params.resource,
    resourceId: params.resourceId,
    count: 1,
    bytes: params.byteDelta,
    timestamp: new Date().toISOString(),
  });
}

export function emitFeatureUsage(params: {
  orgId: string;
  userId: string;
  feature: string;
  metadata?: Record<string, unknown>;
}) {
  emitUsageEvent({
    orgId: params.orgId,
    userId: params.userId,
    category: "feature",
    action: `feature:${params.feature}`,
    count: 1,
    timestamp: new Date().toISOString(),
  });
}
```

## 4.5 Integration with secureHandler

Usage events are emitted automatically for every API call by wrapping the handler response:

```typescript
// In src/lib/secure-handler.ts — after handler execution:

const startTime = Date.now();

// ... execute handler ...

const response = await handler(request, tx, context);

// Emit usage event (non-blocking)
emitApiCall({
  orgId: context.orgId,
  userId: context.userId,
  method: request.method,
  path: request.nextUrl.pathname,
  statusCode: response.status,
  durationMs: Date.now() - startTime,
  deviceType: request.headers.get("x-device-type") ?? undefined,
  ipAddress: request.headers.get("x-forwarded-for") ?? undefined,
});

return response;
```

### AI Token Tracking

The chat stream endpoint already has access to Bedrock's usage metadata. Emit token usage after the stream completes:

```typescript
// In app/api/chat/stream/route.ts — after stream completes:

// The Bedrock response includes usage metadata
const usage = bedrockResponse.usage; // { inputTokens, outputTokens }

emitAiTokens({
  orgId: context.orgId,
  userId: context.userId,
  conversationId,
  tokensIn: usage.inputTokens,
  tokensOut: usage.outputTokens,
  durationMs: streamDuration,
  model: "haiku-4.5",
});
```

## 4.6 DynamoDB Table Design

### Raw Events Table

```
Table: myagency-usage-events
──────────────────────────────────────────────────────────────

Partition Key: PK  (String)  — "ORG#<orgId>"
Sort Key:      SK  (String)  — "TS#<iso-timestamp>#<category>#<uuid-suffix>"

Attributes:
  userId      (String)
  category    (String)    — "api_call" | "ai_tokens" | "storage" | "compute" | "feature"
  action      (String)    — "projects:create", "chat:stream", etc.
  count       (Number)
  tokensIn    (Number)    — nullable
  tokensOut   (Number)    — nullable
  bytes       (Number)    — nullable
  durationMs  (Number)    — nullable
  method      (String)    — nullable
  path        (String)    — nullable
  statusCode  (Number)    — nullable
  deviceType  (String)    — nullable
  ttl         (Number)    — Unix epoch, 90 days from creation

GSI-1: UserIndex
  PK: "USER#<userId>"
  SK: "TS#<iso-timestamp>#<category>"
  Projection: ALL

GSI-2: CategoryIndex
  PK: "ORG#<orgId>#CAT#<category>"
  SK: "TS#<iso-timestamp>"
  Projection: KEYS_ONLY
```

### Key Access Patterns

| Pattern | Key Condition | Index |
|---------|---------------|-------|
| All events for an org in a time range | PK = `ORG#orgId`, SK BETWEEN `TS#start` AND `TS#end` | Table |
| All events for a user in a time range | PK = `USER#userId`, SK BETWEEN `TS#start` AND `TS#end` | GSI-1 |
| All AI token events for an org | PK = `ORG#orgId#CAT#ai_tokens`, SK BETWEEN `TS#start` AND `TS#end` | GSI-2 |
| Count API calls for org today | PK = `ORG#orgId#CAT#api_call`, SK begins_with `TS#2026-03-03` | GSI-2 |

### Real-Time Counters Table

Separate from raw events. Used for quota enforcement (Chapter 5).

```
Table: myagency-usage-counters
──────────────────────────────────────────────────────────────

Partition Key: PK  (String)  — "ORG#<orgId>#<period>"
Sort Key:      SK  (String)  — "<counter_name>"

Attributes:
  value    (Number)    — Atomic counter
  ttl      (Number)    — Auto-expire old periods

Examples:
  PK: "ORG#abc-123#2026-03"        SK: "ai_tokens"         value: 45230
  PK: "ORG#abc-123#2026-03"        SK: "api_calls"         value: 12847
  PK: "ORG#abc-123#2026-03-03"     SK: "api_calls"         value: 423
  PK: "USER#def-456#2026-03-03"    SK: "ai_tokens"         value: 8200
```

## 4.7 Aggregation Pipeline

A Lambda function runs every 5 minutes, reads recent DynamoDB events, and writes aggregated rollups to Aurora.

```typescript
// lambda/usage-aggregator/index.ts

interface AggregatedUsage {
  orgId: string;
  userId: string | null;   // null = org-level aggregate
  period: string;           // "2026-03-03" (daily) or "2026-03" (monthly)
  periodType: "hourly" | "daily" | "monthly";
  category: string;
  apiCalls: number;
  tokensIn: number;
  tokensOut: number;
  storageBytes: number;
  computeMs: number;
  featureEvents: number;
  uniqueUsers: number;
}
```

### Aurora Aggregation Tables

```sql
-- 012_create_usage_aggregates.sql

CREATE TABLE usage_hourly (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id),
  user_id     UUID REFERENCES users(id),
  hour        TIMESTAMPTZ NOT NULL,              -- Truncated to hour
  category    TEXT NOT NULL,
  api_calls   INTEGER NOT NULL DEFAULT 0,
  tokens_in   BIGINT NOT NULL DEFAULT 0,
  tokens_out  BIGINT NOT NULL DEFAULT 0,
  storage_bytes BIGINT NOT NULL DEFAULT 0,
  compute_ms  BIGINT NOT NULL DEFAULT 0,
  feature_events INTEGER NOT NULL DEFAULT 0,

  UNIQUE (org_id, user_id, hour, category)
);

CREATE INDEX idx_usage_hourly_org_hour ON usage_hourly(org_id, hour);
CREATE INDEX idx_usage_hourly_user     ON usage_hourly(user_id, hour);

CREATE TABLE usage_daily (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id),
  user_id     UUID REFERENCES users(id),
  day         DATE NOT NULL,
  category    TEXT NOT NULL,
  api_calls   INTEGER NOT NULL DEFAULT 0,
  tokens_in   BIGINT NOT NULL DEFAULT 0,
  tokens_out  BIGINT NOT NULL DEFAULT 0,
  storage_bytes BIGINT NOT NULL DEFAULT 0,
  compute_ms  BIGINT NOT NULL DEFAULT 0,
  feature_events INTEGER NOT NULL DEFAULT 0,
  unique_users INTEGER NOT NULL DEFAULT 0,

  UNIQUE (org_id, user_id, day, category)
);

CREATE INDEX idx_usage_daily_org_day ON usage_daily(org_id, day);

CREATE TABLE usage_monthly (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id),
  user_id     UUID REFERENCES users(id),
  month       DATE NOT NULL,                     -- First day of month
  category    TEXT NOT NULL,
  api_calls   INTEGER NOT NULL DEFAULT 0,
  tokens_in   BIGINT NOT NULL DEFAULT 0,
  tokens_out  BIGINT NOT NULL DEFAULT 0,
  storage_bytes BIGINT NOT NULL DEFAULT 0,
  compute_ms  BIGINT NOT NULL DEFAULT 0,
  feature_events INTEGER NOT NULL DEFAULT 0,
  unique_users INTEGER NOT NULL DEFAULT 0,
  peak_daily_api_calls INTEGER NOT NULL DEFAULT 0,

  UNIQUE (org_id, user_id, month, category)
);

CREATE INDEX idx_usage_monthly_org ON usage_monthly(org_id, month);

-- RLS on all usage tables
ALTER TABLE usage_hourly ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_hourly FORCE ROW LEVEL SECURITY;
CREATE POLICY usage_hourly_org_isolation ON usage_hourly
  USING (org_id::text = current_setting('app.tenant_id', true));

ALTER TABLE usage_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_daily FORCE ROW LEVEL SECURITY;
CREATE POLICY usage_daily_org_isolation ON usage_daily
  USING (org_id::text = current_setting('app.tenant_id', true));

ALTER TABLE usage_monthly ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_monthly FORCE ROW LEVEL SECURITY;
CREATE POLICY usage_monthly_org_isolation ON usage_monthly
  USING (org_id::text = current_setting('app.tenant_id', true));
```

## 4.8 Usage Query Service

```typescript
// src/services/usage-service.ts

import { eq, and, gte, lte, sql, desc } from "drizzle-orm";
import { usageDaily, usageMonthly, usageHourly } from "@/src/db/schema";
import type { TransactionClient } from "@/src/lib/tenant";

interface UsageSummary {
  apiCalls: number;
  tokensIn: number;
  tokensOut: number;
  totalTokens: number;
  storageBytes: number;
  computeMs: number;
  featureEvents: number;
  estimatedCost: number;
}

export async function getOrgUsageSummary(
  tx: TransactionClient,
  orgId: string,
  month: string               // "2026-03"
): Promise<UsageSummary> {
  const monthDate = new Date(`${month}-01`);

  const rows = await tx
    .select({
      apiCalls: sql<number>`sum(api_calls)::int`,
      tokensIn: sql<number>`sum(tokens_in)::bigint`,
      tokensOut: sql<number>`sum(tokens_out)::bigint`,
      storageBytes: sql<number>`sum(storage_bytes)::bigint`,
      computeMs: sql<number>`sum(compute_ms)::bigint`,
      featureEvents: sql<number>`sum(feature_events)::int`,
    })
    .from(usageMonthly)
    .where(
      and(
        eq(usageMonthly.orgId, orgId),
        eq(usageMonthly.month, monthDate)
      )
    );

  const row = rows[0] || {};
  const tokensIn = Number(row.tokensIn || 0);
  const tokensOut = Number(row.tokensOut || 0);

  return {
    apiCalls: Number(row.apiCalls || 0),
    tokensIn,
    tokensOut,
    totalTokens: tokensIn + tokensOut,
    storageBytes: Number(row.storageBytes || 0),
    computeMs: Number(row.computeMs || 0),
    featureEvents: Number(row.featureEvents || 0),
    estimatedCost: estimateCost(tokensIn, tokensOut),
  };
}

export async function getUserUsageSummary(
  tx: TransactionClient,
  orgId: string,
  userId: string,
  month: string
): Promise<UsageSummary> {
  const monthDate = new Date(`${month}-01`);

  const rows = await tx
    .select({
      apiCalls: sql<number>`sum(api_calls)::int`,
      tokensIn: sql<number>`sum(tokens_in)::bigint`,
      tokensOut: sql<number>`sum(tokens_out)::bigint`,
      storageBytes: sql<number>`sum(storage_bytes)::bigint`,
      computeMs: sql<number>`sum(compute_ms)::bigint`,
      featureEvents: sql<number>`sum(feature_events)::int`,
    })
    .from(usageMonthly)
    .where(
      and(
        eq(usageMonthly.orgId, orgId),
        eq(usageMonthly.userId, userId),
        eq(usageMonthly.month, monthDate)
      )
    );

  const row = rows[0] || {};
  const tokensIn = Number(row.tokensIn || 0);
  const tokensOut = Number(row.tokensOut || 0);

  return {
    apiCalls: Number(row.apiCalls || 0),
    tokensIn,
    tokensOut,
    totalTokens: tokensIn + tokensOut,
    storageBytes: Number(row.storageBytes || 0),
    computeMs: Number(row.computeMs || 0),
    featureEvents: Number(row.featureEvents || 0),
    estimatedCost: estimateCost(tokensIn, tokensOut),
  };
}

export async function getDailyUsageTimeSeries(
  tx: TransactionClient,
  orgId: string,
  startDate: string,
  endDate: string,
  category?: string
) {
  const conditions = [
    eq(usageDaily.orgId, orgId),
    gte(usageDaily.day, new Date(startDate)),
    lte(usageDaily.day, new Date(endDate)),
  ];

  if (category) {
    conditions.push(eq(usageDaily.category, category));
  }

  return tx
    .select({
      day: usageDaily.day,
      category: usageDaily.category,
      apiCalls: sql<number>`sum(api_calls)::int`,
      tokensIn: sql<number>`sum(tokens_in)::bigint`,
      tokensOut: sql<number>`sum(tokens_out)::bigint`,
      uniqueUsers: sql<number>`max(unique_users)::int`,
    })
    .from(usageDaily)
    .where(and(...conditions))
    .groupBy(usageDaily.day, usageDaily.category)
    .orderBy(usageDaily.day);
}

export async function getTopUsersByUsage(
  tx: TransactionClient,
  orgId: string,
  month: string,
  metric: "api_calls" | "tokens_in" | "tokens_out" = "api_calls",
  limit: number = 10
) {
  const monthDate = new Date(`${month}-01`);

  return tx
    .select({
      userId: usageMonthly.userId,
      value: sql<number>`sum(${usageMonthly[metric === "api_calls" ? "apiCalls" : metric === "tokens_in" ? "tokensIn" : "tokensOut"]})`,
    })
    .from(usageMonthly)
    .where(
      and(
        eq(usageMonthly.orgId, orgId),
        eq(usageMonthly.month, monthDate)
      )
    )
    .groupBy(usageMonthly.userId)
    .orderBy(desc(sql`sum(${usageMonthly[metric === "api_calls" ? "apiCalls" : metric === "tokens_in" ? "tokensIn" : "tokensOut"]})`))
    .limit(limit);
}

// ── Cost Estimation ──────────────────────────────────

const TOKEN_COSTS = {
  "haiku-4.5": { input: 0.001, output: 0.005 }, // per 1K tokens
};

function estimateCost(tokensIn: number, tokensOut: number): number {
  const costs = TOKEN_COSTS["haiku-4.5"];
  return (tokensIn / 1000) * costs.input + (tokensOut / 1000) * costs.output;
}
```

## 4.9 Client-Side Hooks

```typescript
// src/hooks/use-usage.ts

"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/src/lib/api-client";

export function useOrgUsage(month: string) {
  return useQuery({
    queryKey: ["usage", "org", month],
    queryFn: async () => {
      const res = await apiFetch(`/api/orgs/current/usage?month=${month}`);
      if (!res.ok) throw new Error("Failed to fetch usage");
      return res.json();
    },
  });
}

export function useMyUsage(month: string) {
  return useQuery({
    queryKey: ["usage", "me", month],
    queryFn: async () => {
      const res = await apiFetch(`/api/usage/me?month=${month}`);
      if (!res.ok) throw new Error("Failed to fetch usage");
      return res.json();
    },
  });
}

export function useUsageTimeSeries(startDate: string, endDate: string, category?: string) {
  return useQuery({
    queryKey: ["usage", "timeseries", startDate, endDate, category],
    queryFn: async () => {
      const params = new URLSearchParams({ startDate, endDate });
      if (category) params.set("category", category);
      const res = await apiFetch(`/api/orgs/current/usage/timeseries?${params}`);
      if (!res.ok) throw new Error("Failed to fetch time series");
      return res.json();
    },
  });
}

export function useTopUsers(month: string, metric?: string) {
  return useQuery({
    queryKey: ["usage", "top-users", month, metric],
    queryFn: async () => {
      const params = new URLSearchParams({ month });
      if (metric) params.set("metric", metric);
      const res = await apiFetch(`/api/orgs/current/usage/top-users?${params}`);
      if (!res.ok) throw new Error("Failed to fetch top users");
      return res.json();
    },
  });
}
```

## 4.10 Feature Usage Tracking

Feature usage tracking is opt-in and lightweight. It answers questions like "How many users have used the project search this month?" and "What percentage of users use dark mode?"

```typescript
// src/lib/usage/track-feature.ts

import { emitFeatureUsage } from "./emitter";

/**
 * Track a feature usage event from the server side.
 * Call this from API handlers for server-side features.
 */
export function trackFeature(
  orgId: string,
  userId: string,
  feature: string
) {
  emitFeatureUsage({ orgId, userId, feature });
}

// Client-side tracking via API:
// POST /api/usage/track { feature: "dark_mode_enabled" }
```

### Predefined Feature Events

| Feature Key | When Tracked |
|-------------|-------------|
| `project_search` | User searches projects with a filter |
| `project_export` | User exports project data |
| `chat_new_conversation` | User starts a new AI conversation |
| `chat_long_conversation` | Conversation exceeds 20 messages |
| `settings_theme_change` | User changes light/dark theme |
| `settings_profile_update` | User updates their profile |
| `members_invite_sent` | Admin sends an invitation |
| `billing_plan_viewed` | User views billing page |
| `data_export_requested` | User requests GDPR data export |
