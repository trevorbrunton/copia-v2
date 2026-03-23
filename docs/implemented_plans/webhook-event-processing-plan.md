# Webhook Event Processing — Implementation Plan

**Status: COMPLETE** (2026-03-11) — All 7 phases implemented, 35 tests passing, 0 critical issues.

## Overview

Build a webhook receiver and event processing pipeline in mayfly-starter that accepts HTTP POST events from mock-alaya's simulation engine (and later from AWS Lambda in production). Events trigger the existing scoring and reasoning pipeline to generate caregiver recommendations for vacated shifts.

## Architecture

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Auth mechanism | Shared secret (`x-webhook-secret` header) | Machine-to-machine; not user auth. Same pattern Lambda would use. Route does NOT use `requireAuthContext` — uses `validateWebhookSecret` instead. |
| Idempotency | `event_id` dedup via `workflow_events` table | Prevents double-processing if event is retried |
| Processing model | Synchronous in request handler | PoC simplicity; mock-alaya sends events sequentially (await each POST). Upgrade to background job queue for production burst scenarios. |
| Local storage | `workflow_events` table (no RLS) | System events, not user data — no `user_id` column. Table uses service-level access only. |
| Dashboard updates | Supabase Realtime on `workflow_events` | Browser subscribes to own DB changes; no polling |
| Realtime config | `ALTER PUBLICATION` is a manual step | Cannot run via `bun scripts/run-migration.ts` — must execute in Supabase SQL Editor |
| Error handling | Existing AppError hierarchy | Consistent with all other routes |

### Production Swap Path

```
PoC:        mock-alaya simulation → POST → /api/v1/webhooks/alayacare → handler
Production: AlayaCare → SQS → Lambda → POST → /api/v1/webhooks/alayacare → handler (same endpoint)
```

Zero code changes required in mayfly-starter when moving to production.

### Request Flow

```
POST /api/v1/webhooks/alayacare
  │
  ├─ traceId = crypto.randomUUID()
  ├─ validateWebhookSecret(request)        # NOT requireAuthContext — M2M auth
  ├─ body = await request.json()
  ├─ event = AlayaCareEventSchema.parse(body)
  ├─ idempotency check (event_id in workflow_events?)
  ├─ INSERT workflow_events (status: "received")
  ├─ dispatch(event, traceId)
  │    ├─ "visit.vacated"    → handleVisitVacated()
  │    ├─ "visit.created"    → handleVisitCreated()
  │    ├─ "employee.status_changed" → handleEmployeeStatusChanged()
  │    ├─ "employee.unavailability.created" → handleEmployeeUnavailability()
  │    ├─ "client.created"   → handleClientCreated()
  │    └─ (unknown)          → log warning, skip
  ├─ UPDATE workflow_events (status: "completed", result)
  └─ return 200 { status: "processed", traceId }
```

### End-to-End Flow (with mock-alaya)

```
mock-alaya                          mayfly-starter                    Browser
──────────                          ──────────────                    ───────

Admin: "Carer resigns"
  │
  engine.ts
  ├─ UPDATE employee
  │  └─ emitEvent() ─── POST ────► /api/v1/webhooks/alayacare
  │                                  ├─ dispatch("employee.status_changed")
  │                                  └─ handleEmployeeStatusChanged()
  │
  ├─ vacate 12 visits
  │  └─ emitEvent() x12 ─ POST ──► /api/v1/webhooks/alayacare
  │                                  ├─ dispatch("visit.vacated") x12
  │                                  ├─ computeMatch() per visit
  │                                  ├─ getRecommendation() per visit
  │                                  └─ INSERT workflow_events
  │                                       │
  │                                       ▼ Supabase Realtime
  │                                  Dashboard auto-updates ──────► Live feed
  │
  └─ return ScenarioResult
```

## Event Contract

Shared with mock-alaya (producer). Validated with Zod on receipt:

```typescript
import { z } from "zod";

const AlayaCareEventSchema = z.object({
  event_id: z.string().uuid(),
  event_type: z.enum([
    "visit.created",
    "visit.updated",
    "visit.vacated",
    "visit.cancelled",
    "employee.created",
    "employee.status_changed",
    "employee.unavailability.created",
    "client.created",
    "service.created",
  ]),
  timestamp: z.string().datetime(),
  payload: z.record(z.unknown()),
  metadata: z.object({
    source: z.enum(["simulation", "lambda"]),
    trace_id: z.string(),
    scenario: z.string().optional(),
  }),
});

type AlayaCareEvent = z.infer<typeof AlayaCareEventSchema>;
```

## New File Structure

```
src/lib/alayacare-events/
  types.ts                            -- AlayaCareEvent Zod schema + types
  validate-webhook.ts                 -- Shared secret validation
  dispatcher.ts                       -- event_type → handler routing

src/server/commands/webhooks/
  handle-visit-vacated.ts             -- Scoring → reasoning → workflow result
  handle-visit-created.ts             -- Log + notify dashboard
  handle-employee-status-changed.ts   -- Detect resignation → flag for bulk reschedule
  handle-employee-unavailability.ts   -- Check affected visits
  handle-client-created.ts            -- Onboarding workflow stub

app/api/v1/webhooks/
  alayacare/route.ts                  -- POST receiver endpoint

src/db/schema.ts                      -- Add workflow_events table
src/db/migrations/                    -- Migration for new table

src/test/
  unit/
    validate-webhook.test.ts
    dispatcher.test.ts
  integration/
    handle-visit-vacated.test.ts
    handle-employee-status-changed.test.ts
    alayacare-route.test.ts
```

## Key Components

### Webhook Authentication

```typescript
// src/lib/alayacare-events/validate-webhook.ts

import { UnauthorizedError, AppError } from "@/src/server/errors";

export function validateWebhookSecret(request: NextRequest): void {
  const secret = request.headers.get("x-webhook-secret");
  const expected = process.env.ALAYACARE_WEBHOOK_SECRET;

  if (!expected) {
    throw new AppError("Webhook secret not configured", "CONFIG_ERROR", 500);
  }
  if (secret !== expected) {
    throw new UnauthorizedError("Invalid webhook secret");
  }
}
```

Not Supabase auth — this is service-to-service. Same pattern Lambda would use with a signing secret.

### Dispatcher

```typescript
// src/lib/alayacare-events/dispatcher.ts

import type { AlayaCareEvent } from "./types";
import { logger } from "@/src/lib/logger";

type EventHandler = (event: AlayaCareEvent, traceId: string) => Promise<unknown>;

const handlers: Record<string, EventHandler> = {};

export function registerHandler(eventType: string, handler: EventHandler): void {
  handlers[eventType] = handler;
}

export async function dispatch(
  event: AlayaCareEvent,
  traceId: string,
): Promise<unknown> {
  const handler = handlers[event.event_type];
  if (!handler) {
    logger.warn({ traceId, eventType: event.event_type }, "No handler for event type");
    return null;
  }
  return handler(event, traceId);
}
```

Registry pattern — each handler file registers itself. Easy to add new event types without modifying the dispatcher.

### API Route

```typescript
// app/api/v1/webhooks/alayacare/route.ts

import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/src/db";
import { workflowEvents } from "@/src/db/schema";
import { validateWebhookSecret } from "@/src/lib/alayacare-events/validate-webhook";
import { AlayaCareEventSchema, type AlayaCareEvent } from "@/src/lib/alayacare-events/types";
import { dispatch } from "@/src/lib/alayacare-events/dispatcher";
import { handleAppError } from "@/src/server/errors";

// --- Idempotency + audit helpers (direct db, no UoW — system events, not user data) ---

/** Check if event was already processed (idempotency). */
async function checkProcessed(eventId: string): Promise<boolean> {
  const rows = await db
    .select({ id: workflowEvents.id })
    .from(workflowEvents)
    .where(eq(workflowEvents.eventId, eventId))
    .limit(1);
  return rows.length > 0;
}

/** Record a newly received event. */
async function recordEvent(
  event: AlayaCareEvent,
  traceId: string,
  status: string,
): Promise<void> {
  await db.insert(workflowEvents).values({
    eventId: event.event_id,
    eventType: event.event_type,
    source: event.metadata.source,
    payload: event.payload,
    traceId,
    status,
  });
}

/** Update event status after processing. */
async function updateEventStatus(
  eventId: string,
  status: string,
  result?: unknown,
): Promise<void> {
  await db
    .update(workflowEvents)
    .set({
      status,
      result: result ?? null,
      processedAt: new Date(),
    })
    .where(eq(workflowEvents.eventId, eventId));
}

// NOTE: This route uses validateWebhookSecret() instead of requireAuthContext().
// Webhook events are machine-to-machine (M2M) — not tied to a Supabase user session.
// The workflow_events table has no RLS (system data, not user data).

export async function POST(request: NextRequest) {
  const traceId = crypto.randomUUID();
  try {
    validateWebhookSecret(request);

    const body = await request.json();
    const event = AlayaCareEventSchema.parse(body);

    // Idempotency: check if event_id already processed
    const existing = await checkProcessed(event.event_id);
    if (existing) {
      return Response.json({ status: "already_processed", traceId });
    }

    // Record receipt
    await recordEvent(event, traceId, "received");

    // Dispatch to handler
    const result = await dispatch(event, traceId);

    // Mark completed
    await updateEventStatus(event.event_id, "completed", result);

    return Response.json({ status: "processed", traceId });
  } catch (err) {
    // On failure, attempt to record error status
    try {
      const body = await request.clone().json();
      if (body?.event_id) {
        await updateEventStatus(body.event_id, "failed");
      }
    } catch { /* best-effort */ }
    return handleAppError(err, traceId);
  }
}
```

Follows the existing route pattern: `traceId → auth → validate → execute → respond`.
Uses direct `db` access (not UoW) since webhook events are system data with no user context.

### Database Schema Addition

```typescript
// Add to src/db/schema.ts

export const workflowEvents = pgTable("workflow_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  eventId: text("event_id").notNull().unique(),         // Idempotency key from AlayaCareEvent
  eventType: text("event_type").notNull(),               // e.g. "visit.vacated"
  source: text("source"),                                // "simulation" | "lambda"
  payload: jsonb("payload"),                             // Original event payload
  status: text("status").notNull().default("received"),  // received | processing | completed | failed
  traceId: text("trace_id"),
  result: jsonb("result"),                               // Scoring + reasoning output
  error: text("error"),                                  // Error message if failed
  processedAt: timestamp("processed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export type WorkflowEvent = typeof workflowEvents.$inferSelect;
export type NewWorkflowEvent = typeof workflowEvents.$inferInsert;
```

Enable Supabase Realtime on this table so the dashboard auto-updates.

**MANUAL STEP** — Run this in the Supabase SQL Editor (not via `bun scripts/run-migration.ts`):

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE workflow_events;
```

## Event Handlers

### handle-visit-vacated.ts (Critical Path)

This is the most important handler — it triggers the full DappaAi scoring and reasoning pipeline:

```typescript
// src/server/commands/webhooks/handle-visit-vacated.ts
//
// Re-uses the same recommendation-building logic as the recommend route.
// Shared helper: buildRecommendationContext() extracts visit/client fetch + context assembly.

import { computeMatch } from "@/src/services/scoring";
import { getRecommendation } from "@/src/services/reasoning";
import type { VisitContext, ClientContext, ReasoningContext } from "@/src/services/reasoning";
import { alayaFetch } from "@/src/lib/alayacare-client";
import { ExternalServiceError } from "@/src/server/errors";
import { logger } from "@/src/lib/logger";
import type { AlayaCareEvent } from "@/src/lib/alayacare-events/types";

interface VisitDetail {
  id: number;
  client_id: number | null;
  start_at: string;
  end_at: string;
  status: string;
  service_instructions?: string | null;
}

interface ClientDetail {
  id: number;
  first_name: string;
  last_name: string;
  city?: string | null;
  state?: string | null;
}

export async function handleVisitVacated(
  event: AlayaCareEvent,
  traceId: string,
): Promise<unknown> {
  const { visit_id, client_id } = event.payload;

  logger.info({ traceId, visitId: visit_id }, "Processing vacated visit");

  // 1. Score candidates (existing scoring engine)
  const matchResult = await computeMatch(visit_id as number, {
    preset: "urgent",
  });

  // 2. Fetch visit + client detail for reasoning context
  // Same pattern as recommend route — extract to shared helper in implementation
  let visitDetail: VisitDetail;
  try {
    visitDetail = await alayaFetch<VisitDetail>(`/scheduler/visits/${visit_id}`);
  } catch (err) {
    throw new ExternalServiceError(
      err instanceof Error ? err.message : "Failed to fetch visit detail"
    );
  }

  const visit: VisitContext = {
    id: visit_id as number,
    start_at: visitDetail.start_at,
    end_at: visitDetail.end_at,
    status: visitDetail.status,
    service_instructions: visitDetail.service_instructions,
  };

  let client: ClientContext | null = null;
  if (matchResult.client_id != null) {
    try {
      const clientDetail = await alayaFetch<ClientDetail>(
        `/patients/clients/${matchResult.client_id}`
      );
      client = {
        first_name: clientDetail.first_name,
        last_name: clientDetail.last_name,
        city: clientDetail.city,
        state: clientDetail.state,
      };
    } catch (err) {
      throw new ExternalServiceError(
        err instanceof Error ? err.message : "Failed to fetch client detail"
      );
    }
  }

  const context: ReasoningContext = {
    urgency: "urgent",
  };

  // 3. LLM reasoning (existing reasoning service)
  let recommendation;
  try {
    recommendation = await getRecommendation({
      visit,
      client,
      matchResult,
      context,
    });
  } catch (err) {
    throw new ExternalServiceError(
      err instanceof Error ? err.message : "LLM reasoning failed"
    );
  }

  logger.info(
    {
      traceId,
      visitId: visit_id,
      topCandidate: recommendation.primary.employee_name,
      confidence: recommendation.primary.confidence,
    },
    "Recommendation generated for vacated visit",
  );

  // Return result for storage in workflow_events.result
  return {
    visit_id,
    match_confidence: matchResult.match_confidence,
    top_candidates: matchResult.candidates.slice(0, 3).map((c) => ({
      employee_id: c.employee_id,
      employee_name: c.employee_name,
      overall_score: c.overall,
    })),
    recommendation: {
      primary: recommendation.primary,
      escalation: recommendation.escalation,
      factors_considered: recommendation.factors_considered,
    },
  };
}
```

**Future enhancements (Phase 1 MVP, not PoC):**
- If high confidence + autonomous mode → auto-assign via `alayaFetch POST /scheduler/visits/{id}`
- If low confidence → escalate to dashboard with full context
- Trigger SMS/notification cascade to top-ranked carer

### handle-visit-created.ts

Light handler — log for dashboard visibility:

```typescript
export async function handleVisitCreated(
  event: AlayaCareEvent,
  traceId: string,
): Promise<unknown> {
  const { visit_id, client_id, employee_id, start_at } = event.payload;

  logger.info({ traceId, visitId: visit_id }, "New visit created");

  // If visit has no employee assigned, it's already vacant — could trigger scoring
  if (employee_id == null) {
    // Delegate to visit.vacated handler logic
  }

  return { visit_id, status: "logged" };
}
```

### handle-employee-status-changed.ts

Detect resignation and flag for bulk reschedule:

```typescript
export async function handleEmployeeStatusChanged(
  event: AlayaCareEvent,
  traceId: string,
): Promise<unknown> {
  const { employee_id, status, previous_status, reason } = event.payload;

  logger.info({ traceId, employeeId: employee_id, status }, "Employee status changed");

  if (status === "terminated") {
    // The individual visit.vacated events will handle scoring per visit.
    // This handler logs the high-level event for dashboard/reporting.
    return {
      employee_id,
      action: "resignation_detected",
      note: "Individual visit.vacated events will trigger scoring",
    };
  }

  return { employee_id, status, action: "logged" };
}
```

### handle-employee-unavailability.ts

```typescript
export async function handleEmployeeUnavailability(
  event: AlayaCareEvent,
  traceId: string,
): Promise<unknown> {
  const { employee_id, unavailability_id } = event.payload;

  logger.info({ traceId, employeeId: employee_id }, "Employee unavailability created");

  // The associated visit.vacated events handle the actual reschedule.
  // This is informational for the dashboard.
  return { employee_id, unavailability_id, action: "logged" };
}
```

### handle-client-created.ts

```typescript
export async function handleClientCreated(
  event: AlayaCareEvent,
  traceId: string,
): Promise<unknown> {
  const { client_id, first_name, last_name, care_needs } = event.payload;

  logger.info({ traceId, clientId: client_id }, "New client registered");

  // Stub for onboarding workflow (Phase 1 MVP)
  return { client_id, action: "logged" };
}
```

## Dashboard Integration

The `workflow_events` table serves as the data source for the real-time operations dashboard. The browser subscribes via Supabase Realtime:

```typescript
// In dashboard component (browser-side)
import { createSupabaseBrowserClient } from "@/src/lib/supabase/client";

const supabase = createSupabaseBrowserClient();

supabase
  .channel("workflow-events")
  .on("postgres_changes", {
    event: "INSERT",
    schema: "public",
    table: "workflow_events",
  }, (payload) => {
    // payload.new = the workflow_events row
    // Update live activity feed, escalation queue, etc.
  })
  .on("postgres_changes", {
    event: "UPDATE",
    schema: "public",
    table: "workflow_events",
  }, (payload) => {
    // Status changed from "received" → "completed"
    // Update processing indicator
  })
  .subscribe();
```

This replaces polling — the dashboard updates instantly when events are processed.

## Error Handling

Follows the existing AppError hierarchy:

| Error | HTTP Status | When |
|-------|-------------|------|
| `UnauthorizedError` | 401 | Invalid or missing webhook secret |
| `ValidationError` | 400 | Event payload fails Zod validation |
| `ExternalServiceError` | 502 | AlayaCare API call fails during handler |
| `AppError` (generic) | 500 | Unexpected handler failure |

Failed events are recorded with `status: "failed"` and `error` message in `workflow_events` for retry/investigation.

## Environment Variables

```env
# Add to .env.local
ALAYACARE_WEBHOOK_SECRET=dev-webhook-secret    # Must match mock-alaya's DAPPAAI_WEBHOOK_SECRET
```

## Implementation Phases

### Phase 1: Foundation

**Files:** types.ts, validate-webhook.ts, dispatcher.ts, workflow_events schema + migration

**TDD**: Write tests FIRST for validate-webhook and dispatcher, then implement.

**Details:**
- Define AlayaCareEvent Zod schema and types
- Build webhook secret validation
- Build event dispatcher with handler registry
- Add `workflow_events` table to schema (no RLS — system data, no `user_id`)
- Run migration via `bun scripts/run-migration.ts`
- Enable Supabase Realtime on `workflow_events` (**manual step** — Supabase SQL Editor)

**Tests:** `src/test/unit/validate-webhook.test.ts`, `src/test/unit/dispatcher.test.ts`

### Phase 2: Webhook Receiver

**Files:** app/api/v1/webhooks/alayacare/route.ts

**TDD**: Write route integration tests FIRST (mock dispatcher), then implement route + helpers.

**Details:**
- POST handler with traceId, validation, idempotency, dispatch
- Helper functions defined in route file: `checkProcessed()`, `recordEvent()`, `updateEventStatus()` — use direct `db` access (no UoW, system data)
- Route uses `validateWebhookSecret()` NOT `requireAuthContext()` — M2M auth pattern
- Follows existing route patterns exactly

**Tests:** `src/test/integration/alayacare-route.test.ts` (mock dispatcher, test auth, idempotency, error cases)

### Phase 3: Core Handler — visit.vacated

**Files:** handle-visit-vacated.ts

**TDD**: Write handler test FIRST (mock scoring + reasoning + alayaFetch), then implement.

**Details:**
- Wire into existing `computeMatch()` scoring engine
- Wire into existing `getRecommendation()` reasoning service — use actual `GetRecommendationOptions` signature with `VisitContext`, `ClientContext`, `ReasoningContext`
- Wrap alayaFetch calls in try/catch → `ExternalServiceError` (same pattern as recommend route)
- Extract shared recommendation-building logic from recommend route into helper if duplication is excessive
- Store result in workflow_events
- This is the critical path — validates end-to-end PoC flow

**Tests:** `src/test/integration/handle-visit-vacated.test.ts` (mock scoring + reasoning, verify result shape matches `LLMRecommendation` fields)

### Phase 4: Supporting Handlers

**Files:** handle-employee-status-changed.ts, handle-employee-unavailability.ts

**TDD**: Write per-handler unit tests FIRST, then implement.

**Details:**
- Informational handlers for dashboard visibility
- Resignation detection and logging
- Lighter than visit.vacated — mostly recording state

**Tests:** `src/test/unit/handle-employee-status-changed.test.ts`, `src/test/unit/handle-employee-unavailability.test.ts`

### Phase 5: Lifecycle Handlers

**Files:** handle-visit-created.ts, handle-client-created.ts

**TDD**: Write per-handler unit tests FIRST, then implement.

**Details:**
- Logging-focused handlers
- visit.created may delegate to vacated logic if no employee assigned
- client.created is a stub for future onboarding workflow

**Tests:** `src/test/unit/handle-visit-created.test.ts`, `src/test/unit/handle-client-created.test.ts`

### Phase 6: Dashboard Integration

**TDD**: Write component tests FIRST for Realtime subscription behavior, then implement.

**Details:**
- Supabase Realtime subscription on `workflow_events`
- Live activity feed component
- Escalation queue (workflow_events where result shows low confidence)
- This builds on existing TanStack Query patterns in the app

### Phase 7: Integration Testing

**Details:**
- End-to-end: mock-alaya simulation → POST → mayfly-starter → scoring → result in workflow_events
- Verify idempotency (same event_id rejected on second POST)
- Verify error handling (bad secret, invalid payload, scoring failure)
- Manual verification with both apps running locally
- Note: mock-alaya sends events sequentially (awaits each POST) — no burst handling needed for PoC

## Future Enhancements (Phase 1 MVP, Post-PoC)

- **Auto-assignment**: High-confidence recommendations auto-assign via AlayaCare API
- **Contact cascade**: Trigger SMS/app notification to top-ranked carer
- **Background processing**: Move handler execution to background job queue for heavy scenarios
- **Retry logic**: Failed events auto-retry with exponential backoff
- **Batch processing**: Handle burst of visit.vacated events from a resignation efficiently
- **Metrics**: Processing time, success rate, scoring latency per event type
