# Observability Plan — Autonomous Rostering Engine

## Overview

Observability strategy for the Upstash + Xano + Next.js architecture defined in [`upstash-xano-architecture.md`](./upstash-xano-architecture.md). Two tiers are presented: a zero-cost option using platform-native tooling, and a paid option using Datadog for full APM.

Both tiers build on the existing structured JSON logger (`src/lib/logger.ts`) and the `daily_metrics` table in Xano.

---

## What Needs Monitoring

### Workflow Health

| Signal | What It Tells You | Alert Threshold |
|---|---|---|
| Workflow step duration (score, reason, contact) | Latency degradation in scoring engine or Bedrock | Scoring >5s, LLM >15s |
| `waitForEvent` timeout rate | Caregivers not responding — process or staffing problem | >50% of contacts timing out |
| Escalation rate | Candidate pool too thin or LLM too conservative | >30% of tasks escalating |
| Workflow failure rate | Code bugs, Xano downtime, or Upstash issues | Any failure (DLQ entry) |
| Time-to-fill distribution | Overall system effectiveness | Median >60min (planned), >30min (urgent) |
| Concurrent workflow count | Burst handling during shift changes | >50 concurrent (capacity planning) |

### External Service Health

| Signal | What It Tells You | Alert Threshold |
|---|---|---|
| AlayaCare API error rate | Partner API degradation | >5% errors in 5min window |
| AlayaCare API latency | Response time trends | p95 >2s |
| Bedrock LLM error rate | Model availability | Any error (triggers fallback path) |
| Bedrock token usage | Cost tracking + quota proximity | >80% of daily quota |
| SMS provider delivery rate | Contact messages reaching caregivers | <95% delivery rate |
| Xano API latency | Database/CRUD performance | p95 >500ms |

### Infrastructure Health

| Signal | What It Tells You | Alert Threshold |
|---|---|---|
| QStash DLQ depth | Failed webhook events needing manual intervention | >0 entries |
| QStash message delivery latency | Webhook processing delay | >10s |
| Redis cache hit rate | Cache effectiveness during burst scoring | <70% hit rate |
| Redis command latency | Rate limiter / cache performance | p95 >50ms |
| Rate limiter rejection rate | API throttling frequency | >10% rejection (may indicate attack or misconfigured limits) |

### Business Metrics

| Signal | What It Tells You | Source |
|---|---|---|
| Tasks created per day | Vacancy volume | Xano `daily_metrics` |
| Tasks filled autonomously | System effectiveness | Xano `daily_metrics` |
| First-contact acceptance rate | Candidate quality / matching accuracy | Xano `daily_metrics` |
| Average time-to-fill | Speed of autonomous filling | Xano `daily_metrics` |
| Escalation reasons breakdown | Why the system can't fill autonomously | Xano `audit_log` aggregation |
| Pattern recognition alerts | always_declines, client_churn, etc. | `analysePatterns()` output |

---

## Option A: Platform-Native (Zero Cost)

Uses built-in dashboards from Upstash, Vercel, and Xano — plus the existing structured logger and a custom metrics API endpoint.

### Components

```
┌─────────────────────────────────────────────────────────────┐
│  Observability Stack (Zero Cost)                             │
│                                                              │
│  ┌──────────────────┐  ┌──────────────────────────────────┐ │
│  │ Structured Logger │  │ Custom Metrics Endpoint          │ │
│  │ (existing)        │  │ GET /api/admin/metrics            │ │
│  │                   │  │                                  │ │
│  │ JSON logs with:   │  │ Queries:                         │ │
│  │ - traceId         │  │ - Xano daily_metrics             │ │
│  │ - step durations  │  │ - Xano audit_log aggregation     │ │
│  │ - error details   │  │ - Redis rate limiter stats       │ │
│  │ - workflow events │  │ - Upstash QStash DLQ count       │ │
│  └──────────────────┘  └──────────────────────────────────┘ │
│                                                              │
│  ┌──────────────────┐  ┌──────────────────────────────────┐ │
│  │ Upstash Console   │  │ Vercel Dashboard                 │ │
│  │                   │  │                                  │ │
│  │ - QStash messages │  │ - Function execution logs        │ │
│  │ - QStash DLQ      │  │ - Function duration              │ │
│  │ - Workflow runs   │  │ - Error rate                     │ │
│  │ - Redis metrics   │  │ - Cold start frequency           │ │
│  └──────────────────┘  └──────────────────────────────────┘ │
│                                                              │
│  ┌──────────────────────────────────────────────────────────┐│
│  │ Xano Dashboard                                           ││
│  │ - API call volume and latency                            ││
│  │ - Table row counts                                       ││
│  │ - Function stack execution metrics                       ││
│  └──────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

### Implementation

#### 1. Enhanced Structured Logging

Extend the existing logger to capture workflow-specific events with consistent fields:

```typescript
// src/lib/logger.ts — add workflow event helpers

export function logWorkflowStep(
  taskId: number,
  step: string,
  durationMs: number,
  result: "success" | "failure" | "skipped",
  details?: Record<string, unknown>
) {
  logger.info("workflow.step", {
    taskId,
    step,
    durationMs,
    result,
    ...details,
  });
}

export function logExternalCall(
  service: "alayacare" | "bedrock" | "xano" | "sms",
  endpoint: string,
  durationMs: number,
  status: number,
  details?: Record<string, unknown>
) {
  logger.info("external.call", {
    service,
    endpoint,
    durationMs,
    status,
    ...details,
  });
}
```

Usage in workflow steps:

```typescript
const start = Date.now();
const result = await context.run("score", async () => {
  const data = await computeMatch(visit, employees, config);
  logWorkflowStep(taskId, "score", Date.now() - start, "success", {
    candidateCount: data.candidates.length,
  });
  return data;
});
```

#### 2. Custom Metrics Endpoint

A single admin endpoint that aggregates operational metrics from all sources:

```typescript
// app/api/admin/metrics/route.ts

import { Redis } from "@upstash/redis";
import { createXanoClient } from "@/src/lib/xano/client";

const redis = Redis.fromEnv();

export async function GET(req: Request) {
  // Admin auth check
  const secret = req.headers.get("x-admin-secret");
  if (secret !== process.env.ADMIN_SECRET) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const xano = createXanoClient("roster", process.env.XANO_SERVICE_TOKEN!);

  const [dailyMetrics, taskCounts, cacheStats, rateLimitStats] = await Promise.all([
    // Business metrics from Xano
    xano.get("/daily_metrics?days=7"),

    // Current task distribution
    xano.get("/roster_tasks/summary"),

    // Redis cache stats
    redis.get<number>("cache:employee-roster:hits").then(h => h ?? 0)
      .then(async (hits) => ({
        hits,
        misses: await redis.get<number>("cache:employee-roster:misses") ?? 0,
      })),

    // Rate limiter rejection counts (last hour)
    Promise.all([
      redis.get<number>("rl:stats:api:rejected") ?? 0,
      redis.get<number>("rl:stats:webhook:rejected") ?? 0,
      redis.get<number>("rl:stats:bedrock:rejected") ?? 0,
    ]).then(([api, webhook, bedrock]) => ({ api, webhook, bedrock })),
  ]);

  return Response.json({
    timestamp: new Date().toISOString(),
    business: dailyMetrics,
    tasks: taskCounts,
    cache: {
      ...cacheStats,
      hitRate: cacheStats.hits + cacheStats.misses > 0
        ? cacheStats.hits / (cacheStats.hits + cacheStats.misses)
        : null,
    },
    rateLimiting: rateLimitStats,
  });
}
```

#### 3. QStash DLQ Monitoring

A scheduled check (Vercel Cron or manual) that alerts on DLQ entries:

```typescript
// app/api/admin/check-dlq/route.ts

import { Client } from "@upstash/qstash";

export async function GET(req: Request) {
  const secret = req.headers.get("x-admin-secret");
  if (secret !== process.env.ADMIN_SECRET) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const qstash = new Client({ token: process.env.QSTASH_TOKEN! });
  const dlqMessages = await qstash.dlq.listMessages();

  if (dlqMessages.messages.length > 0) {
    // Log alert — in production, send to Slack/email
    logger.error("dlq.alert", {
      count: dlqMessages.messages.length,
      oldest: dlqMessages.messages[0]?.createdAt,
      messageIds: dlqMessages.messages.map(m => m.messageId),
    });
  }

  return Response.json({
    dlqDepth: dlqMessages.messages.length,
    messages: dlqMessages.messages.map(m => ({
      id: m.messageId,
      url: m.url,
      createdAt: m.createdAt,
      responseStatus: m.responseStatus,
    })),
  });
}
```

#### 4. Alerting (Lightweight)

Without a dedicated alerting platform, use Vercel Cron + a notification webhook:

```typescript
// vercel.json — schedule DLQ and metrics checks
{
  "crons": [
    { "path": "/api/admin/check-dlq", "schedule": "*/5 * * * *" },
    { "path": "/api/admin/check-health", "schedule": "*/10 * * * *" }
  ]
}
```

```typescript
// app/api/admin/check-health/route.ts
// Checks: escalation rate, DLQ depth, error rate
// If thresholds exceeded → POST to Slack webhook or send email via Xano
```

### What You Get (Option A)

| Capability | Coverage | Limitation |
|---|---|---|
| Workflow execution visibility | Upstash Console shows runs, steps, failures | No custom dashboards |
| Function performance | Vercel shows duration, errors, cold starts | No distributed tracing |
| Business metrics | Custom endpoint + Xano daily_metrics | Manual refresh / polling |
| Error alerting | DLQ check via cron + Slack webhook | 5-minute granularity at best |
| Log search | Vercel log drain or `vercel logs` CLI | No log aggregation across time |
| External API monitoring | Structured logs with duration/status | No dashboards or trend visualization |

### Cost: $0

---

## Option B: Datadog APM (Paid)

Full Application Performance Monitoring with distributed tracing, custom metrics, dashboards, and alerting.

### Components

```
┌─────────────────────────────────────────────────────────────┐
│  Observability Stack (Datadog)                               │
│                                                              │
│  ┌──────────────────────────────────────────────────────────┐│
│  │ Datadog APM                                              ││
│  │                                                          ││
│  │ Distributed Traces:                                      ││
│  │   webhook → QStash → process-event → workflow            ││
│  │     → score (Xano) → reason (Bedrock) → contact (SMS)   ││
│  │     → waitForEvent → finalize (Xano + AlayaCare)         ││
│  │                                                          ││
│  │ Custom Metrics:                                          ││
│  │   rostering.workflow.duration                            ││
│  │   rostering.escalation.rate                              ││
│  │   rostering.contact.timeout_rate                         ││
│  │   rostering.scoring.candidate_count                      ││
│  │   rostering.time_to_fill                                 ││
│  │                                                          ││
│  │ Dashboards:                                              ││
│  │   - Workflow Health (throughput, duration, error rate)    ││
│  │   - External Services (AlayaCare, Bedrock, SMS latency)  ││
│  │   - Business KPIs (fill rate, escalation rate, TTF)      ││
│  │                                                          ││
│  │ Alerting:                                                ││
│  │   - DLQ depth > 0                                        ││
│  │   - Escalation rate > 30%                                ││
│  │   - AlayaCare error rate > 5%                            ││
│  │   - Bedrock latency p95 > 15s                            ││
│  │   - Workflow failure (any)                               ││
│  └──────────────────────────────────────────────────────────┘│
│                                                              │
│  ┌──────────────────┐  ┌──────────────────────────────────┐ │
│  │ Upstash Console   │  │ Vercel Integration               │ │
│  │ (still used for   │  │ (Datadog Vercel integration      │ │
│  │  QStash/Workflow   │  │  auto-ingests function logs      │ │
│  │  operational view) │  │  and traces)                     │ │
│  └──────────────────┘  └──────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### Implementation

#### 1. Setup

```bash
bun add dd-trace
```

```typescript
// src/lib/datadog.ts
// Must be imported FIRST in instrumented entry points

import tracer from "dd-trace";

tracer.init({
  service: "rostera",
  env: process.env.NODE_ENV,
  version: process.env.VERCEL_GIT_COMMIT_SHA ?? "local",
  logInjection: true,
  runtimeMetrics: true,
});

export { tracer };
```

**Note**: `dd-trace` uses native modules and may have compatibility issues with Vercel's Edge Runtime. If deploying to Vercel, use Datadog's [Vercel Integration](https://docs.datadoghq.com/integrations/vercel/) which ingests logs and traces without `dd-trace`. For non-Edge Node.js routes (which the workflow and webhook handlers are), `dd-trace` works normally.

#### 2. Custom Metrics

```typescript
// src/lib/metrics.ts
import { tracer } from "./datadog";

const metrics = tracer.dogstatsd;

export function recordWorkflowStep(
  step: string,
  durationMs: number,
  tags: Record<string, string>
) {
  metrics.histogram("rostering.workflow.step.duration", durationMs, {
    step,
    ...tags,
  });
}

export function recordEscalation(reason: string, urgency: string) {
  metrics.increment("rostering.escalation", 1, {
    reason,
    urgency,
  });
}

export function recordContactOutcome(
  outcome: "accepted" | "declined" | "expired",
  urgency: string,
  rank: number
) {
  metrics.increment("rostering.contact.outcome", 1, {
    outcome,
    urgency,
    rank: String(rank),
  });
}

export function recordTimeToFill(durationMs: number, urgency: string) {
  metrics.histogram("rostering.time_to_fill", durationMs, {
    urgency,
  });
}

export function recordExternalCall(
  service: string,
  durationMs: number,
  status: "success" | "error"
) {
  metrics.histogram("rostering.external.duration", durationMs, {
    service,
    status,
  });
  if (status === "error") {
    metrics.increment("rostering.external.error", 1, { service });
  }
}
```

#### 3. Trace Context in Workflow Steps

```typescript
// Inside workflow serve() callback:
const matchMeta = await context.run("score", async () => {
  const span = tracer.startSpan("rostering.score", {
    tags: { taskId, visitId, urgency },
  });
  try {
    const result = computeMatch(visit, employees, config);
    span.setTag("candidate_count", result.candidates.length);
    recordWorkflowStep("score", span.duration(), { urgency, taskId: String(taskId) });
    return { candidateCount: result.candidates.length };
  } finally {
    span.finish();
  }
});
```

#### 4. Suggested Dashboards

**Dashboard 1: Workflow Health**
- Workflow throughput (runs/hour)
- Step duration heatmap (score, reason, contact, writeback)
- Error rate by step
- Concurrent active workflows
- DLQ depth over time

**Dashboard 2: External Services**
- AlayaCare API: latency p50/p95/p99, error rate, calls/minute
- Bedrock: latency, token usage, error rate
- SMS provider: delivery rate, latency
- Xano: API latency, calls/minute

**Dashboard 3: Business KPIs**
- Fill rate (autonomous vs escalated)
- Escalation rate by reason
- Time-to-fill distribution
- Contact acceptance rate by rank position
- Pattern recognition alerts (always_declines, client_churn)

#### 5. Alerting Rules

| Alert | Condition | Severity | Channel |
|---|---|---|---|
| Workflow failure | Any DLQ entry | Critical | PagerDuty / Slack |
| High escalation rate | >30% over 1 hour | Warning | Slack |
| AlayaCare API degraded | Error rate >5% for 5min | Warning | Slack |
| AlayaCare API down | Error rate >50% for 2min | Critical | PagerDuty |
| Bedrock unavailable | Any error (LLM fallback triggered) | Warning | Slack |
| Contact timeout spike | >50% timeouts in 1 hour | Warning | Slack |
| Scoring latency | p95 >5s for 10min | Warning | Slack |
| Time-to-fill anomaly | Median >2x 7-day average | Info | Slack |

### What You Get (Option B)

| Capability | Coverage |
|---|---|
| Distributed tracing | Full request lifecycle: webhook → QStash → workflow → Xano/Bedrock/AlayaCare |
| Custom metrics | Workflow duration, escalation rate, contact outcomes, time-to-fill |
| Dashboards | 3 pre-built dashboards (workflow, external services, business KPIs) |
| Alerting | Threshold-based alerts with PagerDuty/Slack/email routing |
| Log aggregation | Structured logs searchable across time with trace correlation |
| APM | Function-level performance profiling |

### Cost

| Datadog Plan | Monthly Cost | Includes |
|---|---|---|
| Free | $0 | 1 host, 1-day retention, 5 custom metrics |
| Pro | $15/host/month | 15-month retention, 100 custom metrics, alerting |
| Enterprise | $23/host/month | Watchdog AI, custom roles, longer retention |

For a single Vercel deployment, Pro tier at $15/month is likely sufficient. Add $0.10 per million log events if using log management.

---

## Recommendation

| Stage | Approach | Why |
|---|---|---|
| **Development + PoC** | Option A (platform-native) | Zero cost, sufficient visibility for debugging and validation |
| **Early production** | Option A + Slack webhook alerts | Adds proactive alerting without cost |
| **Production at scale** | Option B (Datadog) | Distributed tracing and custom dashboards become essential when debugging production workflow issues across multiple services |

The trigger to upgrade from A to B is when you're **debugging production issues** and find yourself switching between Upstash Console, Vercel logs, and Xano dashboard to piece together what happened. Datadog collapses that into a single trace view.

---

## Environment Variables (Additional)

### Option A
```bash
ADMIN_SECRET=                              # Auth for /api/admin/* endpoints
```

### Option B (Datadog)
```bash
DD_API_KEY=                                # Datadog API key
DD_SITE=datadoghq.com                      # or datadoghq.eu for EU
DD_SERVICE=rostera                         # Service name in Datadog
DD_ENV=production                          # Environment tag
ADMIN_SECRET=                              # Auth for /api/admin/* endpoints (still used)
```

---

## Cross-References

- **Architecture**: [`upstash-xano-architecture.md`](./upstash-xano-architecture.md) — defines the system being monitored
- **Workflow**: Upstash Workflow `serve()` route at `app/api/roster/workflow/route.ts`
- **Webhook processing**: QStash pipeline at `app/api/webhooks/`
- **Business metrics source**: Xano `daily_metrics` table (materialized daily)
- **Existing logger**: `src/lib/logger.ts` — JSON structured logging (both options build on this)
- **Rate limiters**: `src/lib/rate-limit.ts` — 5 limiters defined (api, login, webhook, bedrock, alayacare)
