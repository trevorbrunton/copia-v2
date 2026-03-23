# Restate Migration Plan — Rostering State Machine

## Executive Summary

Replace the hand-rolled state machine in `src/services/rostering/workflow-orchestrator.ts` with a **Restate durable workflow**. This migration eliminates the three-phase read-external-persist pattern, replaces manual optimistic locking with single-writer guarantees, and — critically — enables the system to **sleep while waiting for caregiver responses** rather than requiring external polling.

The current orchestrator works for the PoC but lacks enterprise-grade durability, timeout handling, and crash recovery. Restate provides these out of the box with minimal infrastructure (single binary, no external dependencies).

---

## Current Architecture

### State Machine Flow

```
detected → gathering → scoring → reasoning → contacting → cascading → accepted → assigned
                                      ↓            ↓            ↓                    ↓
                                  escalated    escalated    escalated             completed
                                                                                     ↓
                                                                              (write-back failed)
                                                                                  assigned
```

### Key Files

| File | Role | Migration Impact |
|------|------|-----------------|
| `src/services/rostering/workflow-orchestrator.ts` | State machine + orchestration | **Replaced** by Restate workflow |
| `src/services/rostering/roster-task-service.ts` | CRUD for roster_tasks | **Modified** — write operations go through Restate |
| `src/services/rostering/cascade-engine.ts` | Pure cascade + escalation logic | **Retained** — called from Restate steps |
| `src/services/rostering/urgency-classifier.ts` | Urgency classification | **Retained** — no change |
| `src/services/rostering/audit-service.ts` | Append-only audit log | **Retained** — called as Restate side effects |
| `src/services/rostering/chat-tools.ts` | 4 read + 3 write tools | **Modified** — write tools signal Restate |
| `src/services/rostering/metrics-service.ts` | Daily metrics aggregation | **Retained** — no change |
| `src/services/rostering/outcome-tracker.ts` | Outcome extraction | **Retained** — no change |
| `src/services/rostering/pattern-recognition.ts` | Pattern analysis | **Retained** — no change |
| `src/services/rostering/data-validator.ts` | Input validation | **Retained** — no change |
| `src/server/commands/roster/process-pending-events.ts` | Batch event → task creation | **Replaced** — Restate workflows triggered directly |
| `src/server/commands/roster/advance-roster-task.ts` | Single task advancement | **Replaced** — events sent to Restate |
| `app/api/v1/webhooks/alayacare/route.ts` | Webhook entry point | **Modified** — triggers Restate workflow |
| `src/server/commands/webhooks/handle-visit-vacated.ts` | Scoring + LLM on vacancy | **Absorbed** into Restate workflow |
| `app/api/v1/roster/tasks/[id]/route.ts` | Human actions (PATCH) | **Modified** — signals Restate instead of DB write |
| `app/api/v1/roster/tasks/route.ts` | List + create tasks | **Modified** — create triggers Restate workflow |
| `app/api/v1/roster/escalations/route.ts` | Escalated task list | **Retained** — reads from DB |
| `app/api/v1/roster/summary/route.ts` | Roster summary | **Retained** — reads from DB |
| `app/api/v1/roster/process-events/route.ts` | Batch event processing | **Removed** — no longer needed |

### Current Pain Points

1. **No waiting mechanism** — `contacting` and `cascading` states cannot suspend while waiting for caregiver SMS/email responses. Requires external polling to re-call `advanceTask()`.
2. **Three-phase orchestration complexity** — read inside UoW → external calls outside UoW → re-read + persist inside UoW with optimistic lock. This pattern exists solely to avoid holding DB transactions during network I/O.
3. **No crash recovery** — if the process crashes between the external call (Phase 2) and the persist (Phase 3), the work is lost and must be retried manually.
4. **Manual timeout management** — escalation timeouts (15min urgent, 60min planned) have no enforcement mechanism. Nothing sends a timeout event.
5. **No-op transitions** — `detected → gathering` and `gathering → scoring` exist only to match the documented state machine but perform no work.
6. **Two-phase event processing** — webhooks store results in `workflow_events`, then a separate admin endpoint (`process-pending-events`) must be called to create user-scoped `roster_tasks` and advance them. This split exists because webhooks use M2M auth (no user context).
7. **Optimistic locking overhead** — every state transition requires version checking and conflict handling.

---

## Restate Architecture

### What Restate Provides

| Capability | How It Works |
|-----------|--------------|
| **Durable execution** | Every `ctx.run()` call is journaled. On crash, execution replays from journal — completed steps return stored results without re-execution |
| **Durable sleep** | `ctx.sleep({ minutes: 15 })` survives process restarts, costs zero resources while sleeping |
| **Awakeables** | `ctx.awakeable()` suspends workflow until an external event resolves it — perfect for waiting on caregiver responses |
| **Virtual Objects** | Keyed stateful entities with single-writer guarantee — one roster task = one virtual object, no optimistic locking needed |
| **Idempotency** | Built-in idempotency keys on workflow invocations — replaces the two-layer webhook idempotency check |
| **Retry policies** | Configurable per-step retries with backoff — replaces manual try/catch fallback patterns |
| **Delayed calls** | Schedule future invocations without holding resources — replaces the need for cron-based timeout polling |

### Deployment Model

```
┌─────────────────────────────────────────────────────────────────────┐
│  Next.js App (Vercel / Node)                                        │
│                                                                     │
│  ┌─────────────────┐  ┌──────────────────┐  ┌───────────────────┐  │
│  │ Webhook Route    │  │ Roster API Routes│  │ Chat Tools        │  │
│  │ POST /webhooks/* │  │ GET/POST/PATCH   │  │ Read + Write      │  │
│  └────────┬────────┘  └────────┬─────────┘  └────────┬──────────┘  │
│           │                    │                      │             │
│           ▼                    ▼                      ▼             │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  Restate Client (HTTP calls to Restate Server)              │    │
│  │  restate.clients.workflow("RosterTask").submit(taskId, ...) │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  Restate Service Handlers (Next.js API route)               │    │
│  │  app/restate/[[...services]]/route.ts                       │    │
│  │  ┌─────────────────────────────────────────────────────┐    │    │
│  │  │  RosterTaskWorkflow                                  │    │    │
│  │  │  - run()           (main workflow)                   │    │    │
│  │  │  - caregiverReply() (awakeable resolver)             │    │    │
│  │  │  - cancel()        (cancellation signal)             │    │    │
│  │  │  - getStatus()     (state query)                     │    │    │
│  │  └─────────────────────────────────────────────────────┘    │    │
│  └─────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                 ┌────────────────────────┐
                 │  Restate Server        │
                 │  (single binary)       │
                 │                        │
                 │  - Durable log         │
                 │  - State management    │
                 │  - Timer scheduling    │
                 │  - Retry orchestration │
                 │                        │
                 │  Deployment options:   │
                 │  - Restate Cloud       │
                 │  - Self-hosted (Docker)│
                 │  - Railway / Fly.io    │
                 └────────────────────────┘
```

**Restate Server** is the only new infrastructure component. Options:
- **Restate Cloud** (managed) — free tier: 50K actions/month, starter $75/month for 5M actions
- **Self-hosted** — single Docker container, no external dependencies. Deploy alongside the app on Railway, Fly.io, or ECS.

---

## Restate Workflow Design

### RosterTaskWorkflow

```typescript
// src/services/rostering/restate-workflow.ts

import * as restate from "@restatedev/restate-sdk";
import { computeMatch } from "@/src/services/scoring";
import { getRecommendation } from "@/src/services/reasoning/reasoning-service";
import { buildRecommendationContext } from "@/src/services/recommendation-context";
import { classifyUrgency, getUrgencyConfig } from "./urgency-classifier";
import { validateMatchInputs } from "./data-validator";
import { appendAudit } from "./audit-service";
import { extractOutcome } from "./outcome-tracker";
import { alayaFetch } from "@/src/lib/alayacare-client";
import { db } from "@/src/db";
import type { ContactAttempt } from "./types";

const MIN_VIABLE_CANDIDATES = 3;

interface RosterTaskInput {
  taskId: string;
  visitId: number;
  clientId?: number;
  urgency?: "planned" | "urgent";
  matchResult?: unknown;        // pre-computed by webhook handler
  llmRecommendation?: unknown;  // pre-computed by webhook handler
}

interface WorkflowResult {
  status: "completed" | "assigned" | "escalated" | "cancelled";
  assignedEmployeeId?: number;
  escalationReason?: string;
  contactsAttempted: number;
}

type CancelledResult = { kind: "cancelled" };
type TimeoutResult = { kind: "timeout" };
type ResponseResult = { kind: "response"; accepted: boolean; declineReason?: string };
type RaceResult = CancelledResult | TimeoutResult | ResponseResult;

export const rosterTaskWorkflow = restate.workflow({
  name: "RosterTask",
  handlers: {

    // ── Main workflow ───────────────────────────────────────────
    run: async (
      ctx: restate.WorkflowContext,
      input: RosterTaskInput
    ): Promise<WorkflowResult> => {
      const { taskId, visitId } = input;
      const urgency = input.urgency ?? "planned";
      const config = getUrgencyConfig(urgency);

      // ── Update status helper (persists to DB as side effect) ──
      const setStatus = async (status: string, extra?: Record<string, unknown>) => {
        ctx.set("status", status);
        await ctx.run(`audit:${status}`, () =>
          writeStatusUpdate(taskId, status, extra)
        );
      };

      // ── Phase 1: Scoring ──────────────────────────────────────
      await setStatus("scoring");

      const matchResult = input.matchResult ?? await ctx.run("score", () =>
        computeMatch(visitId, { preset: config.weightPreset })
      );

      const candidates = (matchResult as { candidates?: unknown[] })?.candidates ?? [];

      if (candidates.length === 0) {
        await setStatus("escalated", { reason: "No eligible candidates" });
        return { status: "escalated", escalationReason: "No eligible candidates", contactsAttempted: 0 };
      }

      if (candidates.length < MIN_VIABLE_CANDIDATES) {
        await setStatus("escalated", { reason: `Thin bench: ${candidates.length} candidate(s)` });
        return { status: "escalated", escalationReason: "Thin bench", contactsAttempted: 0 };
      }

      // ── Phase 2: LLM Reasoning ───────────────────────────────
      await setStatus("reasoning");

      let recommendation = input.llmRecommendation ?? null;
      if (!recommendation) {
        try {
          const ctxResult = await ctx.run("build-context", () =>
            buildRecommendationContext(visitId, matchResult, urgency)
          );
          recommendation = await ctx.run("llm", () =>
            getRecommendation({
              visit: ctxResult.visit,
              client: ctxResult.client,
              matchResult: matchResult as Parameters<typeof getRecommendation>[0]["matchResult"],
              context: ctxResult.context,
            })
          );
        } catch {
          // Fallback: proceed without LLM recommendation (scoring-only)
          recommendation = null;
        }
      }

      // Check for immediate escalation recommendation
      const rec = recommendation as {
        escalation?: { should_escalate: boolean; urgency: string; reason: string };
        primary?: { confidence: string };
      } | null;

      if (rec?.escalation?.should_escalate && rec.escalation.urgency === "immediate") {
        await setStatus("escalated", { reason: rec.escalation.reason });
        return { status: "escalated", escalationReason: rec.escalation.reason, contactsAttempted: 0 };
      }

      if (rec?.primary?.confidence === "low") {
        await setStatus("escalated", { reason: "LLM confidence low — needs human review" });
        return { status: "escalated", escalationReason: "Low confidence", contactsAttempted: 0 };
      }

      // ── Phase 3: Contact Cascade ─────────────────────────────
      await setStatus("contacting");

      const rankedCandidates = candidates as Array<{
        employee_id: number;
        employee_name: string;
        score: number;
        rank: number;
      }>;

      if (config.cascadeStrategy === "parallel") {
        return parallelCascade(ctx, taskId, visitId, rankedCandidates, config);
      }

      return sequentialCascade(ctx, taskId, visitId, rankedCandidates, config);
    },

    // ── External signal: caregiver responds to contact ─────────
    caregiverReply: async (
      ctx: restate.WorkflowSharedContext,
      data: { awakeableId: string; accepted: boolean; declineReason?: string }
    ) => {
      ctx.resolveAwakeable(data.awakeableId, data);
    },

    // ── External signal: cancel the task ────────────────────────
    cancel: async (ctx: restate.WorkflowSharedContext) => {
      ctx.set("status", "cancelled");
      // Resolve the cancellation promise — the main workflow awaits this
      // alongside each awakeable using Promise.race()
      ctx.promise<boolean>("cancel").resolve(true);
    },

    // ── Query: get current status ───────────────────────────────
    getStatus: async (ctx: restate.WorkflowSharedContext) => {
      return {
        status: await ctx.get<string>("status"),
      };
    },
  },
});


// ── Sequential Cascade ─────────────────────────────────────────
// Contact candidates one at a time, wait for response or timeout.

async function sequentialCascade(
  ctx: restate.WorkflowContext,
  taskId: string,
  visitId: number,
  candidates: Array<{ employee_id: number; employee_name: string; score: number; rank: number }>,
  config: { expiryMinutes: number; escalationThreshold: { type: string; value: number } }
): Promise<WorkflowResult> {
  const maxContacts = Math.min(
    candidates.length,
    config.escalationThreshold.type === "contact_count"
      ? config.escalationThreshold.value
      : candidates.length
  );

  for (let i = 0; i < maxContacts; i++) {
    const candidate = candidates[i];

    // Send contact (durable — won't re-send on replay)
    const { id: awakeableId, promise } = ctx.awakeable<{
      accepted: boolean;
      declineReason?: string;
    }>();

    await ctx.run(`contact:${i}`, () =>
      sendContact(taskId, candidate, awakeableId)
    );

    ctx.set("status", "contacting");
    ctx.set("currentCandidate", JSON.stringify(candidate));

    // Wait for response, timeout, or cancellation — whichever comes first
    const cancelPromise = ctx.promise<boolean>("cancel").peek();
    const timeoutPromise = ctx.sleep(config.expiryMinutes * 60_000);

    const result = await restate.CombineablePromise.race([
      promise.then((r) => ({ kind: "response" as const, ...r })),
      timeoutPromise.then(() => ({ kind: "timeout" as const })),
      cancelPromise.then(() => ({ kind: "cancelled" as const })),
    ]);

    if (result.kind === "cancelled") {
      ctx.set("status", "cancelled");
      await ctx.run("audit:cancelled", () =>
        writeStatusUpdate(taskId, "cancelled", { reason: "User cancelled" })
      );
      return { status: "cancelled", contactsAttempted: i + 1 };
    }

    if (result.kind === "response" && result.accepted) {
      return handleAcceptance(ctx, taskId, visitId, candidate.employee_id, i + 1);
    }

    if (result.kind === "response") {
      await ctx.run(`audit:declined:${i}`, () =>
        auditContactResult(taskId, candidate, "declined", result.declineReason)
      );
    } else {
      // Timeout
      await ctx.run(`audit:expired:${i}`, () =>
        auditContactResult(taskId, candidate, "expired")
      );
    }
  }

  // All contacts exhausted
  ctx.set("status", "escalated");
  await ctx.run("audit:escalated", () =>
    writeStatusUpdate(taskId, "escalated", { reason: "All sequential contacts exhausted" })
  );
  return { status: "escalated", escalationReason: "All contacts exhausted", contactsAttempted: maxContacts };
}


// ── Parallel Cascade ───────────────────────────────────────────
// Contact multiple candidates simultaneously, first-accept-wins.

async function parallelCascade(
  ctx: restate.WorkflowContext,
  taskId: string,
  visitId: number,
  candidates: Array<{ employee_id: number; employee_name: string; score: number; rank: number }>,
  config: { expiryMinutes: number; escalationThreshold: { type: string; value: number } }
): Promise<WorkflowResult> {
  const batchSize = Math.min(candidates.length, 5); // Contact top 5 in parallel
  const batch = candidates.slice(0, batchSize);

  // Send all contacts
  const awakeables: Array<{
    candidate: typeof batch[0];
    id: string;
    promise: restate.CombineablePromise<{ accepted: boolean; declineReason?: string }>;
  }> = [];

  for (let i = 0; i < batch.length; i++) {
    const { id, promise } = ctx.awakeable<{ accepted: boolean; declineReason?: string }>();
    await ctx.run(`contact:parallel:${i}`, () =>
      sendContact(taskId, batch[i], id)
    );
    awakeables.push({ candidate: batch[i], id, promise });
  }

  ctx.set("status", "cascading");

  // Race: first acceptance wins, timeout expires all, cancel aborts
  const timeoutMs = config.expiryMinutes * 60_000;
  const cancelPromise = ctx.promise<boolean>("cancel").peek();
  const timeoutPromise = ctx.sleep(timeoutMs);

  // Build race candidates: each awakeable, plus timeout and cancel
  const raceEntries = awakeables.map(({ candidate, promise }, i) =>
    promise.then((r) => ({ kind: "response" as const, index: i, candidate, ...r }))
  );
  raceEntries.push(
    timeoutPromise.then(() => ({ kind: "timeout" as const, index: -1, candidate: null, accepted: false })) as never,
    cancelPromise.then(() => ({ kind: "cancelled" as const, index: -1, candidate: null, accepted: false })) as never,
  );

  // Wait for first resolution — loop until acceptance, timeout, cancel, or all declined
  let acceptedBy: typeof batch[0] | null = null;
  let declinedCount = 0;

  while (acceptedBy === null && declinedCount < batchSize) {
    const result = await restate.CombineablePromise.race(raceEntries);

    if (result.kind === "cancelled") {
      ctx.set("status", "cancelled");
      await ctx.run("audit:cancelled", () =>
        writeStatusUpdate(taskId, "cancelled", { reason: "User cancelled" })
      );
      return { status: "cancelled", contactsAttempted: batchSize };
    }

    if (result.kind === "timeout") break;

    if (result.kind === "response" && result.accepted && result.candidate) {
      acceptedBy = result.candidate;
    } else {
      declinedCount++;
    }
  }

  if (acceptedBy) {
    return handleAcceptance(ctx, taskId, visitId, acceptedBy.employee_id, batchSize);
  }

  ctx.set("status", "escalated");
  await ctx.run("audit:escalated", () =>
    writeStatusUpdate(taskId, "escalated", { reason: "All parallel contacts exhausted" })
  );
  return { status: "escalated", escalationReason: "All parallel contacts exhausted", contactsAttempted: batchSize };
}


// ── Shared Helpers ─────────────────────────────────────────────

async function handleAcceptance(
  ctx: restate.WorkflowContext,
  taskId: string,
  visitId: number,
  employeeId: number,
  contactsAttempted: number
): Promise<WorkflowResult> {
  ctx.set("status", "accepted");

  // Write back to AlayaCare
  try {
    await ctx.run("alayacare-writeback", () =>
      alayaFetch(`/scheduler/visits/${visitId}/offers`, {
        method: "POST",
        body: { employee_id: employeeId },
      })
    );

    ctx.set("status", "completed");
    await ctx.run("audit:completed", () =>
      writeStatusUpdate(taskId, "completed", { assignedEmployeeId: employeeId })
    );
    return { status: "completed", assignedEmployeeId: employeeId, contactsAttempted };
  } catch {
    // Write-back failed — mark as assigned for manual follow-up
    ctx.set("status", "assigned");
    await ctx.run("audit:assigned", () =>
      writeStatusUpdate(taskId, "assigned", {
        assignedEmployeeId: employeeId,
        reason: "AlayaCare write-back failed",
      })
    );
    return { status: "assigned", assignedEmployeeId: employeeId, contactsAttempted };
  }
}

// Side-effect functions called within ctx.run()
async function writeStatusUpdate(taskId: string, status: string, extra?: Record<string, unknown>) {
  // UPDATE roster_tasks SET status = $1, ... WHERE id = $2
  // INSERT INTO roster_audit_log ...
}

async function sendContact(taskId: string, candidate: unknown, awakeableId: string) {
  // Send SMS/email with awakeableId as callback reference
  // The caregiver's reply webhook resolves the awakeable
}

async function auditContactResult(
  taskId: string,
  candidate: unknown,
  result: "declined" | "expired",
  reason?: string
) {
  // INSERT INTO roster_audit_log ...
}
```

### Restate Endpoint (Next.js Route)

```typescript
// app/restate/[[...services]]/route.ts

import * as restate from "@restatedev/restate-sdk/fetch";
import { rosterTaskWorkflow } from "@/src/services/rostering/restate-workflow";

const endpoint = restate.endpoint().bind(rosterTaskWorkflow).handler();

export const POST = (req: Request) => endpoint.fetch(req);
export const GET = (req: Request) => endpoint.fetch(req);
```

---

## Migration Steps

### Phase 0: Infrastructure Setup

1. **Install dependencies**
   ```bash
   bun add @restatedev/restate-sdk
   ```

2. **Set up Restate Server** (choose one)
   - **Development**: `brew install restatedev/tap/restate-server && restate-server`
   - **Production (Cloud)**: Sign up at restate.dev, create environment
   - **Production (self-hosted)**: Deploy Docker container alongside app

3. **Register service endpoint**
   ```bash
   restate deployments register http://localhost:3000/restate
   ```

4. **Add environment variables**
   ```
   RESTATE_ENDPOINT=http://localhost:8080   # Restate server ingress URL
   RESTATE_AUTH_TOKEN=...                   # If using Restate Cloud
   ```

### Phase 1: Parallel Implementation (No Breaking Changes)

Build the Restate workflow alongside the existing orchestrator. Both systems can coexist during migration.

| Task | Detail |
|------|--------|
| Create `src/services/rostering/restate-workflow.ts` | Workflow definition (see design above) |
| Create `app/restate/[[...services]]/route.ts` | Restate service handler endpoint |
| Create `src/lib/restate-client.ts` | Helper to invoke Restate workflows from API routes |
| Add `restate_workflow_id` column to `roster_tasks` | Links DB record to Restate workflow instance |
| Write integration tests | Test workflow execution end-to-end with Restate test server |

**Key principle**: The DB `roster_tasks` table remains the queryable source of truth for the UI. Restate owns the workflow execution, and each step writes status updates back to the DB via `ctx.run()` side effects. This means all existing read queries (list, summary, analytics, audit) continue working unchanged.

### Phase 2: Webhook Integration

Modify the webhook pipeline to trigger Restate workflows instead of storing results for batch processing.

| Current Flow | New Flow |
|---|---|
| Webhook → `workflow_events` table → `process-pending-events` endpoint → `advanceTask()` | Webhook → create `roster_task` row → invoke Restate workflow |

Changes:
- `handle-visit-vacated.ts` — after creating the `roster_task` DB record, invoke `restate.clients.workflow("RosterTask").submit(taskId, input)` instead of storing result in `workflow_events` for later processing
- `process-pending-events.ts` — keep for migrating any pending `workflow_events` from the old system, then deprecate
- Webhook debouncer — evaluate whether still needed (Restate handles concurrency per task, but cache warming for burst scoring may still be valuable)

### Phase 3: API Route Migration

| Route | Change |
|---|---|
| `POST /api/v1/roster/tasks` (create) | After DB insert, invoke Restate workflow |
| `PATCH /api/v1/roster/tasks/[id]` (human action) | Send event to Restate workflow (accept, cancel, take_over) |
| `GET /api/v1/roster/tasks/[id]` | No change — reads from DB |
| `GET /api/v1/roster/tasks` | No change — reads from DB |
| `GET /api/v1/roster/escalations` | No change — reads from DB |
| `GET /api/v1/roster/summary` | No change — reads from DB |
| `POST /api/v1/roster/process-events` | Deprecate — no longer needed |
| `GET /api/v1/roster/audit` | No change — reads from DB |
| `GET /api/v1/roster/analytics` | No change — reads from DB |

### Phase 4: Chat Tools Migration

| Tool | Change |
|------|--------|
| `get_task_status` | No change — reads from DB |
| `query_metrics` | No change — reads from DB |
| `list_recent_tasks` | No change — reads from DB |
| `count_tasks_by_status` | No change — reads from DB |
| `create_roster_task` | After DB insert, invoke Restate workflow |
| `assign_caregiver` | Send `caregiverReply` event to Restate workflow |
| `cancel_task` | Send `cancel` event to Restate workflow |

### Phase 5: Communication Integration

When SMS/email providers are implemented (the `communication/` directory referenced in the Phase 1 architecture doc has not been created yet — provider abstraction is a prerequisite for this phase):

1. **Outbound**: `sendContact()` within `ctx.run()` sends SMS with the Restate awakeable ID embedded in the callback URL
2. **Inbound**: SMS provider webhook (e.g., Twilio status callback) hits a new endpoint that resolves the awakeable:
   ```
   POST /api/v1/webhooks/sms-response
     → extract awakeableId from callback payload
     → restate.clients.workflow("RosterTask").send.caregiverReply(taskId, { awakeableId, accepted })
   ```

### Phase 6: Cleanup

- Remove `workflow-orchestrator.ts`
- Remove `advance-roster-task.ts`
- Remove `process-pending-events.ts` and its route
- Remove `version` column from `roster_tasks` (optimistic locking no longer needed)
- Remove `workflow_events` processing logic (table may be retained for historical data)
- Update CLAUDE.md and architecture docs

---

## What Gets Retained (No Changes)

These modules are pure functions or simple data access — they work identically when called from Restate `ctx.run()` steps:

- `src/services/scoring/` — entire scoring engine
- `src/services/reasoning/` — LLM reasoning layer
- `src/services/recommendation-context.ts` — context builder
- `src/services/rostering/cascade-engine.ts` — cascade logic (used for decision-making, not orchestration)
- `src/services/rostering/urgency-classifier.ts` — urgency classification
- `src/services/rostering/data-validator.ts` — input validation
- `src/services/rostering/audit-service.ts` — audit logging
- `src/services/rostering/metrics-service.ts` — daily metrics
- `src/services/rostering/outcome-tracker.ts` — outcome extraction
- `src/services/rostering/pattern-recognition.ts` — pattern analysis
- `src/lib/alayacare-client.ts` — AlayaCare API client
- `src/lib/alayacare-cache.ts` — TTL cache with stampede prevention

---

## Advantages

### Durability and Crash Recovery

| Scenario | Current | Restate |
|----------|---------|---------|
| Process crashes during LLM call | Work lost, must retry manually | Replays from journal, LLM call re-executes, result persisted |
| Process crashes after LLM, before DB write | LLM result lost | LLM result already journaled, DB write retries automatically |
| Deploy during active cascade | In-flight contacts orphaned | Workflow resumes exactly where it left off |

### Waiting for External Events

| Scenario | Current | Restate |
|----------|---------|---------|
| Wait for caregiver SMS response | **Not possible** — no mechanism to suspend | `ctx.awakeable()` suspends workflow, zero resource consumption |
| Escalation timeout (15min/60min) | **Not enforced** — no timer mechanism | `ctx.sleep()` or `.orTimeout()` — durable, survives restarts |
| Contact expiry check | Requires external polling to call `advanceTask()` | Built into workflow via timeout on awakeable |

### Code Simplification

| Aspect | Current | Restate |
|--------|---------|---------|
| Orchestrator | 428-line `switch` statement with three-phase pattern | Linear async/await workflow |
| Concurrency control | Manual optimistic locking (version column) | Single-writer guarantee per workflow instance |
| Idempotency | Two-layer SELECT + unique constraint | Built-in idempotency keys |
| Error handling | Manual try/catch with fallback patterns | Configurable retry policies per step |
| No-op transitions | `detected→gathering`, `gathering→scoring` | Eliminated — workflow proceeds directly |
| Two-phase event processing | Webhook → `workflow_events` → batch endpoint → `advanceTask()` | Webhook → Restate workflow (single invocation) |

### Observability

- Restate provides built-in workflow introspection (current state, step history, invocation logs)
- Each `ctx.run("step-name", ...)` creates a named journal entry — visible in Restate dashboard
- Failed steps show error details and retry history
- Restate Cloud includes monitoring and alerting

---

## Risks and Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| **Restate server availability** — single point of failure | Medium | Restate Cloud provides multi-AZ; self-hosted can use replicated mode with S3-backed snapshots |
| **Restate maturity** — GA 2024, younger than Temporal | Medium | Core runtime is production-ready (Flink team pedigree); start with non-critical workflows, expand after validation |
| **Network latency** — extra hop through Restate server | Low | Sub-100ms p99 per Restate benchmarks; workflow steps involve AlayaCare API + Bedrock LLM calls (seconds), so Restate overhead is negligible |
| **Vendor coupling** — workflow state lives in Restate | Medium | DB remains queryable source of truth (every step writes back); Restate is open source (BSL license) and self-hostable |
| **Context serialisation** — all `ctx.run()` inputs/outputs must be JSON-serializable | Low | Current system already uses JSONB columns for matchResult, contacts, recommendation — same constraint |
| **Invoked actors restart on restore** — scoring/LLM may re-execute after crash | Low | Scoring is deterministic (same inputs → same output); LLM calls are idempotent (new recommendation is acceptable) |
| **Free tier limits** — 50K actions/month | Low | Each workflow has ~5-15 steps; supports ~3K-10K roster tasks/month on free tier. Starter tier ($75/month) supports 5M actions |

---

## Cost Estimate

| Tier | Monthly Cost | Actions | Sufficient For |
|------|-------------|---------|---------------|
| Free | $0 | 50K | ~3K-10K roster tasks/month (PoC) |
| Starter | $75 | 5M | ~300K+ roster tasks/month |
| Self-hosted | $0 (infra cost only) | Unlimited | Any scale |

Infrastructure cost for self-hosted: one small container (~256MB RAM). On Railway: ~$5/month. On Fly.io: free tier eligible.

---

## Decision Points

Before proceeding, the following decisions should be made:

1. **Restate Cloud vs self-hosted?** — Cloud is simpler operationally; self-hosted gives full control and avoids vendor dependency. Recommendation: start with Cloud free tier for PoC, evaluate self-hosted for production.

2. **XState integration or plain workflow?** — The `@restatedev/xstate` library (v0.5.0, experimental) adds declarative state charts on top of Restate. For this workflow, the linear async/await pattern is likely clearer. XState adds value if the state machine becomes significantly more complex (hierarchical states, parallel regions). Recommendation: start with plain `restate.workflow()`, evaluate XState integration later if needed.

3. **Migration strategy: big bang or gradual?** — The phased plan above supports gradual migration with both systems running in parallel. Recommendation: gradual, with Phase 1-2 as the minimum viable migration.

4. **Webhook debouncer retention?** — The `WebhookDebouncer` batches scoring-heavy events to share the AlayaCare API cache. With Restate, each task is an independent workflow. The cache (`AlayaCareCache` with 30s TTL) still provides value for burst events. Recommendation: retain the cache but evaluate whether the debouncer adds value once Restate handles per-task isolation.

5. **User-scoping model?** — Current two-phase processing exists because webhooks have no user context but roster tasks are user-scoped. Options: (a) assign a system user for webhook-triggered tasks, (b) use Restate's built-in state without user scoping, (c) maintain the current model. Recommendation: assign a system/admin user context for autonomous workflows, consistent with the `createdBy: "system"` default.

---

## Timeline Estimate

| Phase | Scope | Dependencies |
|-------|-------|-------------|
| Phase 0: Infrastructure | Restate server + endpoint setup | None |
| Phase 1: Parallel implementation | Workflow definition + tests | Phase 0 |
| Phase 2: Webhook integration | Trigger workflows from webhooks | Phase 1 |
| Phase 3: API route migration | Human actions via Restate signals | Phase 2 |
| Phase 4: Chat tools migration | Write tools signal Restate | Phase 3 |
| Phase 5: Communication integration | SMS/email awakeable pattern | Phase 4 + provider implementation |
| Phase 6: Cleanup | Remove old orchestrator | All phases complete |

Phases 0-2 are the minimum viable migration. Phases 3-6 can follow incrementally.
