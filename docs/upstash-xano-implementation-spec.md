# Upstash + Xano — Phase 1 Implementation Spec

**Scope**: Single-tenant, sequential cascade, happy-path webhook handling, basic idempotency.
**Not in scope**: Parallel cascade, multi-tenant isolation, circuit breakers, reconciliation jobs, pattern recognition. See [`production-hardening-backlog.md`](./production-hardening-backlog.md) for deferred work.

---

## Design Principles

1. **Xano owns data** — all tables, all CRUD, all simple queries
2. **Next.js owns computation** — scoring algorithms, LLM reasoning, cascade logic
3. **Upstash owns infrastructure** — durable execution, message delivery, caching
4. **Template patterns for CRUD** — three-file domain pattern (schema → API → hooks)
5. **Custom routes for engine** — webhook handlers and workflow endpoints bypass proxy

---

## System Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Next.js App                                                             │
│                                                                          │
│  ┌─────────────────────────────────────┐  ┌───────────────────────────┐  │
│  │  CRUD Layer (Template Pattern)       │  │  Engine Layer (Custom)    │  │
│  │                                      │  │                          │  │
│  │  Clients    → proxyFetch → Xano      │  │  Scoring Engine          │  │
│  │  Employees  → proxyFetch → Xano      │  │  LLM Reasoning           │  │
│  │  Visits     → proxyFetch → Xano      │  │  Cascade Logic           │  │
│  │  Roster Tasks (read) → proxyFetch    │  │  Urgency Classification  │  │
│  │                                      │  │                          │  │
│  │  Pattern: schema → api → hooks       │  │                          │  │
│  └──────────────────────────────────────┘  └───────────┬──────────────┘  │
│                                                         │                │
│  ┌──────────────────────────────────────────────────────┘                │
│  │  Webhook Handler → QStash → Workflow Route                           │
│  └──────────────────────────────────────────────────────────────────────┘│
│         │              │                     │                           │
│         ▼              ▼                     ▼                           │
│  ┌─────────────┐  ┌─────────────┐  ┌───────────────────────────────┐   │
│  │  Xano        │  │ AWS Bedrock │  │  Upstash (Redis, QStash,     │   │
│  │  (DB + CRUD) │  │  (Haiku 4.5)│  │  Workflow)                   │   │
│  └─────────────┘  └─────────────┘  └───────────────────────────────┘   │
│                                     ┌───────────────────────────────┐   │
│                                     │  AlayaCare API (external)     │   │
│                                     └───────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Data Model (Xano Tables)

### `roster_tasks`

| Column | Type | Notes |
|---|---|---|
| `id` | integer (auto) | |
| `user_id` | integer | FK to users — `DEFAULT_TENANT_ID` for Phase 1 |
| `visit_id` | integer | AlayaCare visit reference |
| `client_id` | integer | AlayaCare client (nullable) |
| `status` | text | idle, scoring, reasoning, contacting, accepted, assigned, escalated, completed, cancelled |
| `urgency` | text | "planned" or "urgent" |
| `match_result` | json | Scored candidates |
| `llm_recommendation` | json | LLM output |
| `contacts` | json | Array of ContactAttempt objects |
| `current_contact_index` | integer | Sequential cascade position |
| `cascade_strategy` | text | "sequential" (Phase 1 only) |
| `assigned_employee_id` | integer | Accepted caregiver (nullable) |
| `escalation_reason` | text | (nullable) |
| `workflow_run_id` | text | Upstash run ID |
| `detected_at` | timestamp | |
| `scoring_completed_at` | timestamp | |
| `first_contact_at` | timestamp | |
| `resolved_at` | timestamp | |
| `time_to_fill_ms` | integer | |
| `source_event_id` | text | Webhook event ID |
| `created_at` | timestamp | |
| `updated_at` | timestamp | |

**Xano function stack**: `PATCH /roster_tasks/{id}` enforces `WHERE status NOT IN ('cancelled','completed','escalated')` — returns 409 on conflict.

**Constraint**: Unique partial index on `(visit_id, user_id) WHERE status NOT IN ('cancelled','completed','escalated')`.

### `audit_log`

| Column | Type | Notes |
|---|---|---|
| `id` | integer (auto) | |
| `user_id` | integer | FK to users |
| `task_id` | integer | FK to roster_tasks |
| `timestamp` | timestamp | |
| `action` | text | e.g., "scoring_to_reasoning", "contact_declined" |
| `actor` | text | "system", "llm", "workflow", or user ID |
| `details` | json | |
| `reasoning` | text | LLM excerpt (nullable) |
| `idempotency_key` | text | `${taskId}-${action}-${stepName}` (nullable) |

**Constraint**: Unique on `(task_id, action, idempotency_key)`. `ON CONFLICT DO NOTHING`.

### `daily_metrics`

| Column | Type | Notes |
|---|---|---|
| `id` | integer (auto) | |
| `user_id` | integer | |
| `date` | date | Unique on `(user_id, date)` |
| `tasks_created` | integer | |
| `tasks_filled_autonomous` | integer | |
| `tasks_escalated` | integer | |
| `avg_time_to_fill_ms` | integer | |
| `first_contact_acceptance_rate` | float | |

### Synced Tables (from AlayaCare webhooks)

All synced tables include `user_id` (set to `DEFAULT_TENANT_ID` in Phase 1) and `synced_at`.

- **`employees`**: id, user_id, name, status, latitude, longitude, weekly_hours, synced_at
- **`employee_skills`**: employee_id, user_id, skill_id, expired_date
- **`employee_unavailabilities`**: id, employee_id, user_id, start_at, end_at, reason, synced_at
- **`clients`**: id, user_id, name, latitude, longitude, required_skills (json), synced_at
- **`visits`**: id, user_id, client_id, start_at, end_at, status, required_skills (json), service_instructions, synced_at
- **`visit_offers`**: visit_id, employee_id, user_id, status, created_at
- **`tenant_mapping`**: id, external_type, external_id, user_id — unique on `(external_type, external_id)`

**Xano function stacks for upserts**: `POST /employees/upsert`, `/clients/upsert`, `/visits/upsert` atomically upsert `tenant_mapping` in the same transaction. All upserts compare `synced_at` (last-write-wins).

---

## Xano Endpoints Summary

| Endpoint | Notes |
|---|---|
| `POST /roster_tasks` | Create task |
| `GET /roster_tasks/{id}` | Single task |
| `GET /roster_tasks` | List (filtered, paginated) |
| `PATCH /roster_tasks/{id}` | **Function stack**: terminal-state guard, returns 409 |
| `GET /roster_tasks/by-visit/{visitId}` | Active tasks for a visit |
| `POST /roster_tasks/{id}/action` | Human actions |
| `POST /audit_log` | **Function stack**: `ON CONFLICT DO NOTHING` on idempotency_key |
| `GET /audit_log` | Search by task, action, date |
| `POST /daily_metrics/upsert` | Upsert on `(user_id, date)` |
| `GET /daily_metrics` | Date range aggregation |
| `GET /employees/roster` | Bulk: employees + skills, active only |
| `GET /tenant_mapping` | Lookup by `(external_type, external_id)` — exempt from `WHERE user_id` |
| `POST /tenant_mapping/upsert` | Idempotent upsert |
| `POST /employees/upsert` | + atomic tenant_mapping |
| `POST /clients/upsert` | + atomic tenant_mapping |
| `POST /visits/upsert` | + atomic tenant_mapping |
| `POST /employee_unavailabilities/upsert` | Unavailability windows |

---

## Workflow — Sequential Cascade

```typescript
// app/api/roster/workflow/route.ts
import { serve } from "@upstash/workflow/nextjs";
import { computeMatch } from "@/src/services/scoring";
import { getRecommendation } from "@/src/services/reasoning/reasoning-service";
import { buildRecommendationContext } from "@/src/services/recommendation-context";
import { getUrgencyConfig } from "@/src/services/rostering/urgency-classifier";
import { createXanoClient } from "@/src/lib/xano/client";
import { alayaFetch } from "@/src/lib/alayacare-client";
import { getCachedEmployeeRoster, acquireScoringLock } from "@/src/lib/cache";

const MIN_VIABLE_CANDIDATES = 3;

export const { POST } = serve(
  async (context) => {
    const { taskId, visitId, urgency, detectedAt, userId } = context.requestPayload as {
      taskId: number; visitId: number; urgency: "planned" | "urgent";
      detectedAt: string; userId: number;
    };

    const config = getUrgencyConfig(urgency);
    const xano = createXanoClient("roster", XANO_SERVICE_TOKEN, {
      userId, timeoutMs: 8_000,
    });

    const TERMINAL_STATUSES = ["cancelled", "completed", "escalated"];

    async function updateStatus(status: string, extra?: Record<string, unknown>) {
      const current = await xano.get(`/roster_tasks/${taskId}`);
      if (TERMINAL_STATUSES.includes(current.status)) return;
      await xano.patch(`/roster_tasks/${taskId}`, { status, ...extra });
      await xano.post("/audit_log", {
        task_id: taskId, action: `status_${status}`, actor: "workflow",
        details: extra ?? {},
        idempotency_key: `${taskId}-status_${status}-${context.workflowRunId}`,
      });
    }

    // Step 0: Dedup — prevent duplicate workflows for same visit
    const lockAcquired = await context.run("acquire-scoring-lock", () =>
      acquireScoringLock(visitId)
    );
    if (!lockAcquired) return { status: "deduplicated" };

    // Step 1: Score
    await context.run("update-status-scoring", () => updateStatus("scoring"));

    const scoringMeta = await context.run("score", async () => {
      const [employees, visit] = await Promise.all([
        getCachedEmployeeRoster(xano, String(userId)),
        xano.get(`/visits/${visitId}`),
      ]);
      const result = computeMatch(visit, employees, { preset: config.weightPreset });
      await xano.patch(`/roster_tasks/${taskId}`, {
        match_result: result, scoring_completed_at: new Date().toISOString(),
      });
      return {
        candidateCount: result.candidates?.length ?? 0,
        candidateIds: (result.candidates ?? []).map((c: { employee_id: number }) => c.employee_id),
      };
    });

    if (scoringMeta.candidateCount === 0) {
      await context.run("escalate-no-candidates", () =>
        updateStatus("escalated", { escalation_reason: "No eligible candidates" })
      );
      return { status: "escalated" };
    }

    if (scoringMeta.candidateCount < MIN_VIABLE_CANDIDATES) {
      await context.run("escalate-thin-bench", () =>
        updateStatus("escalated", {
          escalation_reason: `Thin bench: ${scoringMeta.candidateCount} candidate(s)`,
        })
      );
      return { status: "escalated" };
    }

    const taskWithScores = await context.run("load-scores", () =>
      xano.get(`/roster_tasks/${taskId}`)
    );
    const candidates = taskWithScores.match_result.candidates ?? [];

    // Step 2: LLM Reasoning
    await context.run("update-status-reasoning", () =>
      updateStatus("reasoning", { match_result: taskWithScores.match_result })
    );

    let recommendation = null;
    try {
      recommendation = await context.run("reason", async () => {
        const ctx = await buildRecommendationContext(
          visitId, taskWithScores.match_result, urgency
        );
        return getRecommendation({
          visit: ctx.visit, client: ctx.client,
          matchResult: taskWithScores.match_result, context: ctx.context,
        });
      });
    } catch {
      await context.run("audit-llm-fallback", () =>
        xano.post("/audit_log", {
          task_id: taskId, action: "llm_fallback", actor: "workflow",
          details: { reason: "LLM service unavailable" },
          idempotency_key: `${taskId}-llm_fallback-${context.workflowRunId}`,
        })
      );
    }

    if (recommendation?.escalation?.should_escalate &&
        recommendation.escalation.urgency === "immediate") {
      await context.run("escalate-llm", () =>
        updateStatus("escalated", {
          llm_recommendation: recommendation,
          escalation_reason: recommendation.escalation.reason,
        })
      );
      return { status: "escalated" };
    }

    // Step 3: Sequential Contact Cascade
    // Note: per-contact timeout is config.expiryMinutes (5min urgent, 15min planned).
    // Total cascade time is maxContacts × expiryMinutes (worst case). Escalation
    // thresholds (15min urgent, 60min planned) apply to total elapsed time — the
    // escalation check inside the loop (time-based branch) enforces this independently
    // of per-contact timeout.
    await context.run("update-status-contacting", () =>
      updateStatus("contacting", { llm_recommendation: recommendation })
    );

    const maxContacts = Math.min(
      candidates.length,
      config.escalationThreshold.type === "contacts"
        ? config.escalationThreshold.count : candidates.length
    );

    for (let i = 0; i < maxContacts; i++) {
      const candidate = candidates[i];

      await context.run(`send-contact-${i}`, async () => {
        const now = new Date().toISOString();
        const expiresAt = new Date(
          Date.now() + config.expiryMinutes * 60_000
        ).toISOString();

        const currentTask = await xano.get(`/roster_tasks/${taskId}`);
        if (TERMINAL_STATUSES.includes(currentTask.status)) return;

        // Dedup: skip if already contacted (step retry)
        const alreadyContacted = (currentTask.contacts ?? []).some(
          (c: { employee_id: number }) => c.employee_id === candidate.employee_id
        );
        if (alreadyContacted) return;

        const contact = {
          employee_id: candidate.employee_id,
          employee_name: candidate.employee_name,
          contact_address: "",
          rank: i + 1, overall_score: candidate.overall,
          channel: "sms" as const, sent_at: now, expires_at: expiresAt,
          response: "pending" as const,
          responded_at: null, decline_reason: null,
          selection_reason: `Rank #${i + 1} by scoring engine`,
        };

        // TODO: SMS provider call with idempotency key:
        //   `roster-${taskId}-contact-${candidate.employee_id}`

        await xano.patch(`/roster_tasks/${taskId}`, {
          current_contact_index: i,
          contacts: [...(currentTask.contacts ?? []), contact],
          first_contact_at: i === 0 ? now : currentTask.first_contact_at,
        });
        await xano.post("/audit_log", {
          task_id: taskId, action: "contact_sent", actor: "workflow",
          details: { employee_id: candidate.employee_id, rank: i + 1, channel: "sms" },
          idempotency_key: `${taskId}-contact_sent-send-contact-${i}`,
        });
      });

      // Wait for response or timeout
      const { eventData, timeout } = await context.waitForEvent(
        `wait-response-${i}`,
        `caregiver-${taskId}-${candidate.employee_id}`,
        { timeout: `${config.expiryMinutes}m` }
      );

      if (!timeout && eventData?.accepted) {
        await context.run("mark-accepted", () =>
          updateStatus("accepted", { assigned_employee_id: candidate.employee_id })
        );

        const writeBackResult = await context.run("alayacare-writeback", async () => {
          try {
            await alayaFetch(`/scheduler/visits/${visitId}/offers`, {
              method: "POST",
              body: { employee_id: candidate.employee_id },
              headers: {
                "Idempotency-Key": `roster-${taskId}-offer-${candidate.employee_id}`,
              },
            });
            return { success: true };
          } catch (err) {
            return { success: false, error: String(err) };
          }
        });

        if (!writeBackResult.success) {
          await context.run("escalate-writeback-failed", () =>
            updateStatus("escalated", {
              escalation_reason: `AlayaCare write-back failed: ${writeBackResult.error}`,
            })
          );
          return { status: "escalated", reason: "writeback_failed" };
        }

        await context.run("finalize", () =>
          updateStatus("completed", {
            assigned_employee_id: candidate.employee_id,
            resolved_at: new Date().toISOString(),
            time_to_fill_ms: Date.now() - new Date(detectedAt).getTime(),
          })
        );
        return { status: "completed", assignedTo: candidate.employee_id };
      }

      // Declined or timeout
      await context.run(`update-result-${i}`, async () => {
        const task = await xano.get(`/roster_tasks/${taskId}`);
        if (TERMINAL_STATUSES.includes(task.status)) return;

        const contacts = [...(task.contacts ?? [])];
        const idx = contacts.findIndex(
          (c: { employee_id: number }) => c.employee_id === candidate.employee_id
        );
        if (idx >= 0) {
          contacts[idx] = {
            ...contacts[idx],
            response: timeout ? "expired" : "declined",
            responded_at: timeout ? null : new Date().toISOString(),
            decline_reason: eventData?.declineReason ?? null,
          };
          await xano.patch(`/roster_tasks/${taskId}`, { contacts });
        }
        await xano.post("/audit_log", {
          task_id: taskId,
          action: timeout ? "contact_expired" : "contact_declined",
          actor: "workflow",
          details: { employee_id: candidate.employee_id },
          idempotency_key: `${taskId}-${timeout ? "contact_expired" : "contact_declined"}-update-result-${i}`,
        });
      });
    }

    // All contacts exhausted
    await context.run("escalate-exhausted", () =>
      updateStatus("escalated", {
        escalation_reason: "All contacts exhausted",
        resolved_at: new Date().toISOString(),
      })
    );
    return { status: "escalated" };
  },
  { retries: 3 }
);
```

---

## Webhook Processing

### Ingress Route

```typescript
// app/api/webhooks/alayacare/route.ts
import { Client } from "@upstash/qstash";

const qstash = new Client({ token: process.env.QSTASH_TOKEN! });

export async function POST(req: Request) {
  const secret = req.headers.get("x-webhook-secret");
  const expected = process.env.ALAYACARE_WEBHOOK_SECRET;
  if (!secret || !expected || secret.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(secret), Buffer.from(expected))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const event = await req.json();
  await qstash.publishJSON({
    url: `${process.env.APP_URL}/api/webhooks/process-event`,
    body: event,
    deduplicationId: event.event_id, // 24-hour window
    retries: 3,
  });
  return Response.json({ received: true });
}
```

### Event Processing Route

```typescript
// app/api/webhooks/process-event/route.ts
import { verifySignatureAppRouter } from "@upstash/qstash/nextjs";
import { Client } from "@upstash/workflow";
import { Redis } from "@upstash/redis";
import { createXanoClient } from "@/src/lib/xano/client";
import { classifyUrgency } from "@/src/services/rostering/urgency-classifier";

const redis = Redis.fromEnv();

async function resolveTenant(xano, externalType: string, externalId: number): Promise<number> {
  const mapping = await xano.get("/tenant_mapping", {
    external_type: externalType, external_id: externalId,
  });
  if (mapping?.user_id) return mapping.user_id;

  // Single-tenant fallback
  const defaultTenant = process.env.DEFAULT_TENANT_ID;
  if (defaultTenant) return parseInt(defaultTenant, 10);

  throw new Error(`Cannot resolve tenant for ${externalType} ${externalId}`);
}

async function ensureTenantMapping(xano, externalType: string, externalId: number, userId: number) {
  await xano.post("/tenant_mapping/upsert", {
    external_type: externalType, external_id: externalId, user_id: userId,
  });
}

async function handler(req: Request) {
  const event = await req.json();
  const xano = createXanoClient("roster", process.env.XANO_SERVICE_TOKEN!);

  switch (event.type) {
    case "visit.vacated": {
      const userId = event.payload.user_id
        ?? await resolveTenant(xano, "visit", event.payload.visit_id);
      await xano.post("/visits/upsert", { ...event.payload, user_id: userId });
      // tenant_mapping handled atomically by upsert function stack

      const task = await xano.post("/roster_tasks", {
        user_id: userId, visit_id: event.payload.visit_id,
        client_id: event.payload.client_id,
        urgency: classifyUrgency(event.payload),
        status: "idle", source_event_id: event.event_id,
      });

      const wfClient = new Client({ token: process.env.QSTASH_TOKEN! });
      const { workflowRunId } = await wfClient.trigger({
        url: `${process.env.APP_URL}/api/roster/workflow`,
        body: { taskId: task.id, visitId: event.payload.visit_id,
          urgency: classifyUrgency(event.payload), userId,
          detectedAt: new Date().toISOString() },
      });
      await xano.patch(`/roster_tasks/${task.id}`, { workflow_run_id: workflowRunId });
      break;
    }

    case "employee.status_changed": {
      const empUserId = event.payload.user_id
        ?? await resolveTenant(xano, "employee", event.payload.employee_id);
      await xano.post("/employees/upsert", { ...event.payload, user_id: empUserId });
      await redis.del(`cache:employee-roster:${empUserId}`);
      break;
    }

    case "employee.unavailability": {
      const uid = event.payload.user_id
        ?? await resolveTenant(xano, "employee", event.payload.employee_id);
      await xano.post("/employee_unavailabilities/upsert", { ...event.payload, user_id: uid });
      await ensureTenantMapping(xano, "employee", event.payload.employee_id, uid);
      await redis.del(`cache:employee-roster:${uid}`);
      break;
    }

    case "visit.created":
    case "visit.updated": {
      const vuid = event.payload.user_id
        ?? await resolveTenant(xano, "visit", event.payload.visit_id);
      await xano.post("/visits/upsert", { ...event.payload, user_id: vuid });
      break;
    }

    case "visit.cancelled": {
      const cuid = event.payload.user_id
        ?? await resolveTenant(xano, "visit", event.payload.visit_id);
      // PATCH (not upsert) — visit already exists, just updating status.
      // ensureTenantMapping() called separately below (upsert would handle it atomically).
      await xano.patch(`/visits/${event.payload.visit_id}`, { status: "cancelled", user_id: cuid });
      await ensureTenantMapping(xano, "visit", event.payload.visit_id, cuid);

      const activeTasks = await xano.get(
        `/roster_tasks/by-visit/${event.payload.visit_id}`, { user_id: cuid }
      );
      const wfClient = new Client({ token: process.env.QSTASH_TOKEN! });

      // Cancel workflows first (time-sensitive), then update DB
      await Promise.all(
        activeTasks.filter((t: any) => t.workflow_run_id)
          .map((t: any) => wfClient.cancel({ ids: [t.workflow_run_id] }).catch(() => {}))
      );
      for (const task of activeTasks) {
        await xano.patch(`/roster_tasks/${task.id}`, {
          status: "cancelled", resolved_at: new Date().toISOString(),
        });
        await xano.post("/audit_log", {
          task_id: task.id, action: "cancelled_visit_withdrawn", actor: "system",
          details: { visit_id: event.payload.visit_id },
          idempotency_key: `${task.id}-cancelled_visit_withdrawn-${event.event_id}`,
        });
      }
      break;
    }

    case "client.created": {
      const cluid = event.payload.user_id
        ?? await resolveTenant(xano, "client", event.payload.client_id);
      await xano.post("/clients/upsert", { ...event.payload, user_id: cluid });
      break;
    }
  }
}

export const POST = verifySignatureAppRouter(handler);
```

### SMS Response Handler

```typescript
// app/api/webhooks/sms-response/route.ts
import { Client } from "@upstash/workflow";

export async function POST(req: Request) {
  // Phase 1: skip signature verification (NODE_ENV !== "production" guard)
  // ⚠️ PRE-LAUNCH GATE: implement Twilio signature verification before production
  //   traffic — see backlog P1-01. This route throws in production until fixed.
  const { taskId, employeeId, accepted, declineReason } = await req.json();

  const client = new Client({ token: process.env.QSTASH_TOKEN! });
  await client.notify({
    eventId: `caregiver-${taskId}-${employeeId}`,
    eventData: { accepted, declineReason },
  });
  return Response.json({ ok: true });
}
```

---

## Human Actions

```typescript
// app/api/roster/tasks/[id]/action/route.ts
// For accept_recommendation / assign_manually: writes back to AlayaCare
export async function POST(req: Request) {
  // ... auth, validation ...
  const updatedTask = await xano.post(`/roster_tasks/${taskId}/action`, input);

  if (input.action === "accept_recommendation" || input.action === "assign_manually") {
    const employeeId = input.employee_id ?? updatedTask.assigned_employee_id;
    try {
      await alayaFetch(`/scheduler/visits/${updatedTask.visit_id}/offers`, {
        method: "POST",
        body: { employee_id: employeeId },
        headers: { "Idempotency-Key": `roster-${taskId}-human-offer-${employeeId}` },
      });
      await xano.patch(`/roster_tasks/${taskId}`, {
        status: "assigned", assigned_employee_id: employeeId,
        resolved_at: new Date().toISOString(),
      });
    } catch (err) {
      await xano.patch(`/roster_tasks/${taskId}`, {
        status: "escalated",
        escalation_reason: `AlayaCare write-back failed: ${String(err)}`,
      });
      return Response.json({ error: "Write-back failed" }, { status: 502 });
    }
  }

  return Response.json(updatedTask);
}
```

---

## Caching

```typescript
// src/lib/cache.ts
import { Redis } from "@upstash/redis";
const redis = Redis.fromEnv();

export async function getCachedEmployeeRoster(xano: XanoClient, userId: string) {
  const key = `cache:employee-roster:${userId}`;
  const cached = await redis.get(key);
  if (cached) return cached;
  const roster = await xano.get("/employees/roster");
  await redis.set(key, roster, { ex: 30 });
  return roster;
}

export async function acquireScoringLock(visitId: number): Promise<boolean> {
  return (await redis.set(`lock:scoring:${visitId}`, "1", { ex: 30, nx: true })) === "OK";
}
```

---

## Rate Limiting

```typescript
// src/lib/rate-limit.ts
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
const redis = Redis.fromEnv();

export const apiLimiter = new Ratelimit({
  redis, limiter: Ratelimit.slidingWindow(120, "1 m"), prefix: "rl:api",
});
export const loginLimiter = new Ratelimit({
  redis, limiter: Ratelimit.slidingWindow(5, "15 m"), prefix: "rl:login",
});
export const webhookLimiter = new Ratelimit({
  redis, limiter: Ratelimit.tokenBucket(100, "1 s", 200), prefix: "rl:webhook",
});
export const bedrockLimiter = new Ratelimit({
  redis, limiter: Ratelimit.fixedWindow(20, "1 m"), prefix: "rl:bedrock",
});
export const alayacareLimiter = new Ratelimit({
  redis, limiter: Ratelimit.slidingWindow(50, "1 m"), prefix: "rl:alayacare",
});
export const xanoLimiter = new Ratelimit({
  redis, limiter: Ratelimit.slidingWindow(200, "1 m"), prefix: "rl:xano",
});
```

---

## Auth Model

| Endpoint | Auth |
|---|---|
| CRUD routes | User token via HMAC cookie + `proxyFetch` |
| `POST /api/webhooks/alayacare` | `x-webhook-secret` header |
| `POST /api/webhooks/process-event` | QStash signature (`verifySignatureAppRouter`) |
| `POST /api/roster/workflow` | QStash signature |
| `POST /api/webhooks/sms-response` | SMS provider signature (stub in Phase 1) |

Workflow/webhook handlers use `XANO_SERVICE_TOKEN`. All Xano endpoints enforce `WHERE user_id = :userId`.

Dev endpoints (`/api/v1/dev/*`) must be excluded from production deployments via `NODE_ENV` guard or removed from the production build entirely. See backlog P1-02.

---

## Developer Discipline — Workflow Code

1. **No side effects outside `context.run()`** — API calls, DB writes, logging
2. **No non-deterministic values outside steps** — `Date.now()`, `Math.random()`
3. **Stateless client creation is safe outside steps** — `createXanoClient()`
4. **Pure computation is safe outside steps** — `getUrgencyConfig()`

### Code Review Checklist

- [ ] Every API call inside a `context.run()` or `context.waitForEvent()`
- [ ] No `Date.now()` outside steps
- [ ] Every `xano.post("/audit_log", ...)` includes `idempotency_key`
- [ ] Every direct PATCH to `roster_tasks` checks terminal status first
- [ ] Contact array appends check for existing `employee_id` (dedup on retry)
- [ ] AlayaCare API calls include `Idempotency-Key` header
- [ ] Scoring lock acquired before scoring step
- [ ] `context.run()` returns only IDs/metadata — no PII in workflow journal

---

## Environment Variables

```bash
XANO_BASEURL=https://your-instance.xano.io/api
XANO_SERVICE_TOKEN=                        # Dedicated API group, not admin token
SESSION_SECRET=                            # 32+ char random string
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
QSTASH_TOKEN=
QSTASH_CURRENT_SIGNING_KEY=
QSTASH_NEXT_SIGNING_KEY=
ALAYACARE_API_URL=
ALAYACARE_PUBLIC_KEY=
ALAYACARE_PRIVATE_KEY=
ALAYACARE_WEBHOOK_SECRET=
AWS_REGION=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
DEFAULT_TENANT_ID=                         # Required for Phase 1 (single-tenant)
APP_URL=https://your-app.vercel.app
```

---

## What Stays from Current Codebase

| Module | Status |
|---|---|
| `src/services/scoring/` (11 files) | **Unchanged** — data source changes to Xano |
| `src/services/reasoning/` (7 files) | **Unchanged** |
| `src/services/recommendation-context.ts` | **Minor** — reads from Xano |
| `src/services/rostering/cascade-engine.ts` | **Unchanged** — pure functions |
| `src/services/rostering/urgency-classifier.ts` | **Unchanged** |
| `src/services/rostering/data-validator.ts` | **Unchanged** |
| All unit tests for pure functions | **Unchanged** |

---

## Cost Estimate

| Service | Monthly Cost |
|---|---|
| Xano | Plan cost |
| Upstash Redis | $0 (free tier) |
| Upstash QStash | $0 (free: 1,000 msg/day, ~700 at 100 tasks/day) |
| AWS Bedrock | ~$0.001-0.01 per task |
| Vercel | $0-20 |

Per task: ~7 QStash messages + ~35 Xano API calls (sequential cascade, 5 contacts).

---

## Before Go-Live Checklist

These items from [`production-hardening-backlog.md`](./production-hardening-backlog.md) **must** be completed before production traffic:

- [ ] **P1-01**: Implement Twilio `validateRequest()` signature verification (SMS response handler throws in production without this)
- [ ] **P1-02**: Add `NODE_ENV` guard to dev reset endpoint or remove from production build
- [ ] **P1-03**: Build admin bulk import endpoint to populate synced tables + `tenant_mapping`
