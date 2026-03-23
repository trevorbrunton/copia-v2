# Phase 1 Implementation Plan — Autonomous Shift Filling MVP

**Status: COMPLETE (2026-03-11)**
**Timeline:** Weeks 9–24 (8 two-week sprints)
**Depends on:** PoC 1 (scoring engine) ✅, PoC 2 (LLM reasoning) ✅, Webhook event processing ✅, Mock-alaya simulation engine ✅

## Overview

Build and deploy the core autonomous agent for shift matching and filling using text-based communication (SMS, email, app notifications). The system detects vacant shifts, scores candidates, applies LLM reasoning, contacts caregivers via SMS/email, handles responses, cascades to next candidates, and escalates to humans when needed.

### Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Reduction in shift-filling phone calls | ≥30% | Compare with pre-DappaAi baseline |
| Average time-to-fill (planned shifts) | ≤20 minutes | `resolved_at - detected_at` on `roster_tasks` |
| First-contact acceptance rate | ≥30% | `contacts[0].response === "accepted"` / total tasks |

### What's Already Built

| Component | Location | Sprint |
|-----------|----------|--------|
| Scoring engine (`computeMatch()`) | `src/services/scoring/` | PoC 1 (S1–S4) |
| LLM reasoning (`getRecommendation()`) | `src/services/reasoning/` | PoC 2 (S5–S7) |
| Recommendation context builder | `src/services/recommendation-context.ts` | S7 |
| Webhook receiver + M2M auth | `app/api/v1/webhooks/alayacare/route.ts` | S8 |
| Event dispatcher + 5 handlers | `src/lib/alayacare-events/`, `src/server/commands/webhooks/` | S8 |
| `workflow_events` table | `src/db/migrations/011_create_workflow_events.sql` | S8 |
| AlayaCare API client (`alayaFetch()`) | `src/lib/alayacare-client.ts` | S2 |
| Mock-alaya simulation engine (7 scenarios) | `~/mock-alaya/` | Delivered |
| Bedrock Haiku 4.5 LLM client | `src/lib/llm/` | S5 |
| SSE streaming helper | `src/lib/sse.ts` | S7 |

### Architecture Reference

Full architecture: `docs/phase1-rostering-architecture.md`
Requirements: `docs/poc.txt` (Phase 1 MVP section)
Traceability: `docs/poc-traceability.md` (P1.1–P1.21)

---

## State Machine

```
DETECTED → GATHERING → SCORING → REASONING → CONTACTING → ACCEPTED → ASSIGNED → COMPLETED
                                      │             │
                                      ▼             ▼
                                  ESCALATED    NO_RESPONSE → CASCADING (→ CONTACTING or ESCALATED)
```

Status enum: `detected | gathering | scoring | reasoning | contacting | cascading | accepted | assigned | escalated | completed | cancelled`

---

## Database Schema (3 New Tables)

Migration 012: `src/db/migrations/012_create_roster_tables.sql`

```sql
-- Roster task tracking
CREATE TABLE IF NOT EXISTS roster_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  visit_id INTEGER NOT NULL,
  client_id INTEGER,
  status TEXT NOT NULL DEFAULT 'detected',
  urgency TEXT NOT NULL DEFAULT 'planned',
  version INTEGER NOT NULL DEFAULT 1,

  match_result JSONB,
  llm_recommendation JSONB,
  contacts JSONB NOT NULL DEFAULT '[]',
  current_contact_index INTEGER NOT NULL DEFAULT 0,
  cascade_strategy TEXT NOT NULL DEFAULT 'sequential',

  assigned_employee_id INTEGER,
  escalated_to UUID REFERENCES users(id),
  escalation_reason TEXT,

  -- Links back to workflow_events for audit trail
  source_event_id TEXT,

  detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  scoring_completed_at TIMESTAMPTZ,
  first_contact_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  time_to_fill_ms INTEGER,

  created_by TEXT NOT NULL DEFAULT 'system',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Audit log (append-only)
CREATE TABLE IF NOT EXISTS roster_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES roster_tasks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  action TEXT NOT NULL,
  actor TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}',
  reasoning TEXT
);

-- Analytics (materialised daily)
CREATE TABLE IF NOT EXISTS roster_daily_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  date DATE NOT NULL,
  tasks_created INTEGER NOT NULL DEFAULT 0,
  tasks_filled_autonomous INTEGER NOT NULL DEFAULT 0,
  tasks_escalated INTEGER NOT NULL DEFAULT 0,
  avg_time_to_fill_ms INTEGER,
  first_contact_acceptance_rate NUMERIC(5,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, date)
);

-- RLS
ALTER TABLE roster_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE roster_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE roster_daily_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY roster_tasks_isolation ON roster_tasks FOR ALL USING (user_id = auth.uid());
CREATE POLICY roster_audit_isolation ON roster_audit_log FOR ALL USING (user_id = auth.uid());
CREATE POLICY roster_metrics_isolation ON roster_daily_metrics FOR ALL USING (user_id = auth.uid());

-- Indexes
CREATE INDEX IF NOT EXISTS idx_roster_tasks_user_status ON roster_tasks (user_id, status);
CREATE INDEX IF NOT EXISTS idx_roster_tasks_visit_id ON roster_tasks (visit_id);
CREATE INDEX IF NOT EXISTS idx_roster_tasks_source_event ON roster_tasks (source_event_id);
CREATE INDEX IF NOT EXISTS idx_roster_audit_task_id ON roster_audit_log (task_id);
CREATE INDEX IF NOT EXISTS idx_roster_audit_user_id ON roster_audit_log (user_id);
CREATE INDEX IF NOT EXISTS idx_roster_metrics_user_date ON roster_daily_metrics (user_id, date);
```

**Rollback script:** `src/db/migrations/012_drop_roster_tables.sql` — prepared but not applied:
```sql
DROP TABLE IF EXISTS roster_daily_metrics CASCADE;
DROP TABLE IF EXISTS roster_audit_log CASCADE;
DROP TABLE IF EXISTS roster_tasks CASCADE;
```

Drizzle schema additions in `src/db/schema.ts`:
- `rosterTasks` — pgTable with all columns above (including `version` for optimistic locking)
- `rosterAuditLog` — pgTable with FK to rosterTasks
- `rosterDailyMetrics` — pgTable with unique(user_id, date)
- Export `$inferSelect` / `$inferInsert` types for each

---

## Phase 1 File Structure

```
src/services/
  rostering/
    types.ts                    # RosterTask, ContactAttempt, AuditEntry, enums, Zod schemas
    roster-task-service.ts      # CRUD for roster tasks (tx, userId pattern)
    workflow-orchestrator.ts    # State machine: advanceTask()
    urgency-classifier.ts      # planned vs urgent
    cascade-engine.ts           # Sequential/parallel contact strategies
    data-validator.ts           # Pre-flight checks before scoring
    audit-service.ts            # Append audit entries
    metrics-service.ts          # Daily metrics materialisation
    index.ts

  reasoning/                    # EXISTING — extend, don't rebuild
    (existing files)

  communication/
    types.ts                    # Channel types, message templates, response types
    dispatcher.ts               # Route messages to correct channel
    sms-provider.ts             # SMSProvider interface + Twilio implementation
    email-provider.ts           # EmailProvider interface + SES/SendGrid implementation
    response-handler.ts         # Process inbound responses (LLM-parsed)
    templates.ts                # Shift offer, confirmation, cancellation templates
    index.ts

src/server/
  commands/
    roster/
      create-roster-task.ts     # Manual task creation
      advance-roster-task.ts    # State machine advancement
      process-pending-events.ts # Two-phase: reads workflow_events → creates RosterTasks
      handle-human-action.ts    # Accept/assign/defer/takeover/cancel
    webhooks/
      (existing handlers — stay stateless, return computed results)

  queries/
    roster/
      list-roster-tasks.ts      # Filterable by status
      get-roster-task.ts        # Detail with audit trail
      list-escalations.ts       # Escalated tasks queue
      get-analytics.ts          # 30-day metrics
      search-audit-log.ts       # Searchable audit log

src/hooks/
  use-roster-tasks.ts           # TanStack Query CRUD hooks
  use-escalations.ts            # Escalation queue hooks
  use-roster-analytics.ts       # Analytics hooks
  use-roster-audit.ts           # Audit log hooks

app/api/v1/
  roster/
    tasks/route.ts              # POST + GET (list)
    tasks/[id]/route.ts         # GET (detail) + PATCH (actions)
    process-events/route.ts     # POST — two-phase: process workflow_events → create RosterTasks
  roster/escalations/route.ts   # GET escalation queue
  roster/analytics/route.ts     # GET 30-day metrics
  roster/audit/route.ts         # GET searchable audit log
  webhooks/
    alayacare/route.ts          # EXISTING — stays stateless (compute only)
    sms/route.ts                # Inbound SMS webhook (Twilio in prod, simulation in dev)
    email/route.ts              # Inbound email webhook
  dev/
    simulate-response/route.ts  # Dev-only: simulate caregiver response (mock mode only)

app/(app)/
  roster/
    page.tsx                    # Active roster tasks list
    [id]/page.tsx               # Task detail + audit trail
  escalations/page.tsx          # Escalation queue
  analytics/page.tsx            # 30-day metrics dashboard

components/rostering/
  activity-feed.tsx             # Live task activity stream
  task-card.tsx                 # Roster task summary card
  task-detail.tsx               # Full task view with audit trail
  escalation-card.tsx           # Escalation queue item
  candidate-list.tsx            # Scored candidates with assign actions
  score-bar.tsx                 # Visual score indicator
  audit-timeline.tsx            # Chronological audit entry display
  analytics-charts.tsx          # 30-day metric visualisations
```

---

## API Routes

| Method | Route | Purpose | Sprint | Auth |
|--------|-------|---------|--------|------|
| POST | `/api/v1/roster/tasks` | Create roster task (manual trigger) | P1.1 | User |
| GET | `/api/v1/roster/tasks` | List active tasks (filterable by status) | P1.1 | User |
| GET | `/api/v1/roster/tasks/[id]` | Task detail with full audit trail | P1.1 | User |
| POST | `/api/v1/roster/process-events` | Two-phase: process webhook events → create RosterTasks | P1.1 | User |
| PATCH | `/api/v1/roster/tasks/[id]` | Human actions (accept, assign, defer, take over, cancel) | P1.5 | User |
| GET | `/api/v1/roster/escalations` | Escalated tasks queue | P1.5 | User |
| GET | `/api/v1/roster/analytics` | 30-day metrics | P1.7 | User |
| GET | `/api/v1/roster/audit` | Searchable audit log | P1.7 | User |
| POST | `/api/v1/webhooks/alayacare` | AlayaCare event webhook receiver | ✅ Done | M2M |
| POST | `/api/v1/webhooks/sms` | Inbound SMS webhook (Twilio in prod, simulation in dev) | P1.3 | Twilio sig |
| POST | `/api/v1/webhooks/email` | Inbound email webhook | P1.6 | Provider sig |
| POST | `/api/v1/dev/simulate-response` | Simulate caregiver SMS/email response (dev only, mock mode) | P1.3 | User |

All user-facing routes: `traceId → requireAuthContext → makeDeps() → handler → Response.json()`
Webhook routes: provider-specific signature verification (not user auth).

### Two-Phase Webhook → RosterTask Pattern (P9 decision)

Webhook handlers are M2M (no user auth) but `roster_tasks` is user-scoped (RLS via `auth.uid()`). These are incompatible. The solution is a **two-phase pattern**:

```
Phase 1: Webhook (M2M, stateless)
  POST /api/v1/webhooks/alayacare
    → validateWebhookSecret()
    → dispatch(event)
    → handler computes: scoring + LLM recommendation
    → result stored in workflow_events.result (no RLS, system table)
    → return 200

Phase 2: Event Processor (user-authenticated)
  POST /api/v1/roster/process-events
    → requireAuthContext()
    → query workflow_events WHERE status = <verified_status> AND result IS NOT NULL
                                AND NOT EXISTS (SELECT 1 FROM roster_tasks WHERE source_event_id = event_id)
    NOTE: verify actual status value set by existing handlers in src/server/commands/webhooks/
    (default is "received" — handlers may set "processed", "completed", or other value)
    → for each unprocessed event:
      → create RosterTask within UoW (user_id = ctx.principalId)
      → call advanceTask() to start pipeline
    → return { processed: count }
```

**Why this works:**
- Webhooks stay stateless — no deps, no ctx, no UoW (existing pattern preserved)
- RosterTask creation happens within authenticated UoW (RLS enforced correctly)
- `workflow_events.result` already stores scoring + recommendation data (existing pattern)
- `roster_tasks.source_event_id` links back to the originating event (prevents double-processing)
- Dashboard can call process-events on load, or a Vercel Cron can trigger it periodically

**Trigger options for Phase 2:**
- **Manual:** Dashboard "Process Events" button (simplest for MVP)
- **On page load:** `/roster` page calls `POST /api/v1/roster/process-events` on mount
- **Scheduled:** Vercel Cron every 60s (same mechanism as P1.6.5)
- **Recommendation:** On-page-load for MVP, scheduled cron when reliable automation is needed

---

## Sprint P1.1: Foundation — Task Persistence & Orchestrator Core (2 weeks)

### Goal
State machine advancing through scoring + reasoning with task persistence. Data validation prevents bad scoring inputs. No communication yet (dry-run mode). 3 API routes + client hook.

### Prerequisites
- PoC 1 scoring engine ✅
- PoC 2 LLM reasoning ✅
- Webhook event processing ✅

### Tasks

#### P1.1.1 — Database migration

**File:** `src/db/migrations/012_create_roster_tables.sql`

SQL as defined in the Database Schema section above. Run via `bun scripts/run-migration.ts`.

**File:** `src/db/schema.ts`

Add Drizzle table definitions:

```typescript
export const rosterTasks = pgTable("roster_tasks", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id),
  visitId: integer("visit_id").notNull(),
  clientId: integer("client_id"),
  status: text("status").notNull().default("detected"),
  urgency: text("urgency").notNull().default("planned"),
  version: integer("version").notNull().default(1),
  matchResult: jsonb("match_result"),
  llmRecommendation: jsonb("llm_recommendation"),
  contacts: jsonb("contacts").notNull().default("[]"),
  currentContactIndex: integer("current_contact_index").notNull().default(0),
  cascadeStrategy: text("cascade_strategy").notNull().default("sequential"),
  assignedEmployeeId: integer("assigned_employee_id"),
  escalatedTo: uuid("escalated_to").references(() => users.id),
  escalationReason: text("escalation_reason"),
  sourceEventId: text("source_event_id"),
  detectedAt: timestamp("detected_at", { withTimezone: true }).notNull().defaultNow(),
  scoringCompletedAt: timestamp("scoring_completed_at", { withTimezone: true }),
  firstContactAt: timestamp("first_contact_at", { withTimezone: true }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  timeToFillMs: integer("time_to_fill_ms"),
  createdBy: text("created_by").notNull().default("system"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const rosterAuditLog = pgTable("roster_audit_log", { ... });
export const rosterDailyMetrics = pgTable("roster_daily_metrics", { ... });
```

**Tests:** Integration test confirming table creation and basic CRUD.

#### P1.1.2 — Rostering types

**File:** `src/services/rostering/types.ts`

```typescript
// Enums
export type RosterTaskStatus =
  | "detected" | "gathering" | "scoring" | "reasoning"
  | "contacting" | "cascading" | "accepted" | "assigned"
  | "escalated" | "completed" | "cancelled";

export type Urgency = "planned" | "urgent";
export type CascadeStrategy = "sequential" | "parallel";
export type ContactResponse = "pending" | "accepted" | "declined" | "expired";
export type ContactChannel = "sms" | "email";

// Interfaces
export interface ContactAttempt {
  employee_id: number;
  employee_name: string;
  contact_address: string;           // Phone number (SMS) or email address — sourced from AlayaCare employee data
  rank: number;
  overall_score: number;
  channel: ContactChannel;
  sent_at: string;
  expires_at: string;
  response: ContactResponse;
  responded_at: string | null;
  decline_reason: string | null;
  selection_reason: string;
}

export interface AuditEntry {
  timestamp: string;
  action: string;
  actor: "system" | "llm" | string;  // "system", "llm", or user ID
  details: Record<string, unknown>;
  reasoning?: string;
}

// Zod schemas for API validation
export const CreateRosterTaskInput = z.object({
  visit_id: z.number().int().positive(),
  client_id: z.number().int().positive().optional(),
  urgency: z.enum(["planned", "urgent"]).optional(),
});

export const RosterTaskStatusFilter = z.object({
  status: z.enum([...ALL_STATUSES]).optional(),
  limit: z.number().int().min(1).max(100).optional().default(50),
  offset: z.number().int().min(0).optional().default(0),
});
```

**Tests:** Unit tests for Zod schemas (valid/invalid input).

#### P1.1.3 — Roster task service

**File:** `src/services/rostering/roster-task-service.ts`

Follows existing `(tx, userId, ...)` pattern:

```typescript
export async function createRosterTask(tx, userId, input): Promise<RosterTask>;
export async function getRosterTask(tx, userId, taskId): Promise<RosterTask | null>;
export async function listRosterTasks(tx, userId, filter): Promise<RosterTask[]>;
export async function updateRosterTask(tx, userId, taskId, updates, expectedVersion: number): Promise<RosterTask>;
export async function appendAuditEntry(tx, userId, taskId, entry): Promise<void>;
```

**Optimistic locking on `updateRosterTask`:** The `expectedVersion` parameter enforces concurrent update safety:
```typescript
export async function updateRosterTask(tx, userId, taskId, updates, expectedVersion: number): Promise<RosterTask> {
  const [updated] = await tx
    .update(rosterTasks)
    .set({ ...updates, version: expectedVersion + 1, updatedAt: new Date() })
    .where(and(
      eq(rosterTasks.id, taskId),
      eq(rosterTasks.userId, userId),
      eq(rosterTasks.version, expectedVersion),  // Only update if version matches
    ))
    .returning();
  if (!updated) throw new ConflictError("Task was modified concurrently — retry");
  return updated;
}
```

This prevents race conditions when two concurrent `advanceTask` calls try to update the same task. The second call will find a version mismatch and throw `ConflictError` (409).

**Tests:** Integration tests — CRUD operations, user isolation (query with different userId returns nothing), optimistic lock conflict test (update with stale version → ConflictError).

#### P1.1.4 — Workflow orchestrator (state machine)

**File:** `src/services/rostering/workflow-orchestrator.ts`

```typescript
/**
 * Main orchestration pipeline — called when a task needs to advance.
 *
 * CRITICAL DESIGN: External API calls (AlayaCare, Bedrock LLM) run OUTSIDE the
 * UoW transaction to avoid holding DB connections during network I/O. The pattern:
 *   1. Read task state inside UoW — deps.uow.run(ctx, async (txCtx) => { ... txCtx.db ... })
 *   2. Run external calls outside UoW (compute, fetch, LLM)
 *   3. Persist results inside UoW (with optimistic lock check)
 *
 * UoW API: deps.uow.run(ctx: AuthContext, fn: (txCtx: TransactionContext) => Promise<T>)
 *   - ctx sets JWT claims for RLS (auth.uid() = ctx.principalId)
 *   - txCtx.db is the TransactionClient passed to service functions
 *
 * Design: async pipeline, not long-running process (P1 decision).
 * Next step triggered by webhook callback, scheduled poll, or timeout timer.
 */

// Top-level orchestrator — coordinates UoW and external calls
// UoW API: deps.uow.run(ctx, async (txCtx) => { ... txCtx.db ... })
//   - ctx: AuthContext (sets JWT claims for RLS — auth.uid() = ctx.principalId)
//   - txCtx: TransactionContext (access DB via txCtx.db: TransactionClient)
export async function advanceTask(
  deps: { uow: UnitOfWork },
  ctx: AuthContext,
  taskId: string,
): Promise<RosterTask> {
  // Phase 1: Read current state (inside UoW)
  const task = await deps.uow.run(ctx, async (txCtx) => {
    return getRosterTask(txCtx.db, ctx.principalId, taskId);
  });

  // Phase 2: Run external calls OUTSIDE UoW (no DB transaction held)
  const externalResult = await runExternalStep(task);

  // Phase 3: Persist results (inside UoW, with optimistic lock)
  return deps.uow.run(ctx, async (txCtx) => {
    return persistStepResult(txCtx.db, ctx.principalId, task, externalResult);
  });
}

// External calls — no tx parameter, no DB connection held
async function runExternalStep(task: RosterTask): Promise<StepResult> {
  switch (task.status) {
    case "detected":
      // Fetch visit + client + employee pool from AlayaCare
      return { nextStatus: "gathering", data: await gatherFromAlayaCare(task.visitId) };
    case "gathering":
      // Run computeMatch() — self-contained, calls alayaFetch internally
      return { nextStatus: "scoring", data: await computeMatch(task.visitId, config) };
    case "scoring":
      // Build context + run LLM recommendation — both call external APIs
      const context = await buildRecommendationContext(task.visitId, task.matchResult, task.urgency);
      const recommendation = await getRecommendation({ ...context });
      return { nextStatus: "reasoning", data: { context, recommendation } };
    case "reasoning":
      return { nextStatus: "contacting", data: null };  // P1.3+ (dry-run in P1.1)
    case "contacting":
      return { nextStatus: "cascading", data: null };    // P1.3+
    case "cascading":
      return { nextStatus: "contacting", data: null };   // P1.4+
    case "accepted":
      // Write-back to AlayaCare
      await assignInAlayaCare(task);
      return { nextStatus: "assigned", data: null };     // P1.5+
    default:
      return { nextStatus: task.status, data: null };    // Terminal state
  }
}

// Persist results — inside UoW, checks version for optimistic locking
// Called within deps.uow.run() — receives TransactionClient (txCtx.db) and userId (ctx.principalId)
async function persistStepResult(db: TransactionClient, userId: string, task: RosterTask, result: StepResult): Promise<RosterTask> {
  const updated = await updateRosterTask(db, userId, task.id, {
    status: result.nextStatus,
    ...(result.data ? { matchResult: result.data } : {}),
  }, task.version); // version check — throws ConflictError if stale
  await appendAudit(db, userId, task.id, { action: `${task.status}_to_${result.nextStatus}`, actor: "system" });
  return updated;
}
```

**Why external calls run outside UoW:**
- `computeMatch()` calls `alayaFetch()` internally — network I/O to AlayaCare API
- `buildRecommendationContext()` fetches visit + client data from AlayaCare
- `getRecommendation()` calls Bedrock LLM — can take 2-10 seconds
- Holding a DB transaction open during these calls risks connection pool exhaustion and statement timeouts
- The optimistic lock (`version` column) ensures no lost updates if concurrent advancement occurs

**State transitions implemented in P1.1:**
- `detected → gathering`: Fetch visit + client + employee pool via `alayaFetch()` (external)
- `gathering → scoring`: Run `computeMatch()` (external, self-contained)
- `scoring → reasoning`: Run `buildRecommendationContext()` + `getRecommendation()` (external)
- `reasoning → contacting/escalated`: Check `should_escalate` — if true + immediate → ESCALATED; else → CONTACTING (dry-run: log but don't send, advance to COMPLETED)

**Duplicate AlayaCare fetch mitigation:** `computeMatch()` and `buildRecommendationContext()` both fetch visit data from AlayaCare. In the `scoring` step, `computeMatch` runs first and returns a `MatchResult` which is passed to `buildRecommendationContext()`. The context builder should accept the already-fetched visit data from the match result to avoid a redundant API call. Refactor `buildRecommendationContext()` to accept optional pre-fetched data:
```typescript
// Current: fetches visit + client internally
buildRecommendationContext(visitId, matchResult, urgency)
// Refactored: accepts optional pre-fetched data to avoid duplicate AlayaCare calls
buildRecommendationContext(visitId, matchResult, urgency, { prefetchedVisit?, prefetchedClient? })
```

**Integration with existing code:**
- Import `computeMatch` from `src/services/scoring/`
- Import `getRecommendation` from `src/services/reasoning/`
- Import `buildRecommendationContext` from `src/services/recommendation-context.ts`
- Import `alayaFetch` from `src/lib/alayacare-client.ts`

**Tests:**
- Unit tests for each state transition function (mock `alayaFetch`, `computeMatch`, `getRecommendation`)
- Unit test: verify external calls do NOT receive `tx` parameter
- Integration test: full pipeline detected → completed in dry-run mode
- Test escalation path: when `should_escalate: true, urgency: "immediate"` → ESCALATED
- Test optimistic lock: concurrent advancement of same task → ConflictError on second attempt

#### P1.1.5 — Urgency classifier

**File:** `src/services/rostering/urgency-classifier.ts`

```typescript
export function classifyUrgency(visit: { start_at: string; service_instructions?: string }): Urgency {
  const hoursUntilShift = (new Date(visit.start_at).getTime() - Date.now()) / (1000 * 60 * 60);
  if (hoursUntilShift < 4) return "urgent";
  if (visit.service_instructions?.includes("URGENT")) return "urgent";
  return "planned";
}

export function getUrgencyConfig(urgency: Urgency) {
  return urgency === "urgent"
    ? { weightPreset: "urgent", cascadeStrategy: "parallel", expiryMinutes: 20, escalationThreshold: { type: "time", minutes: 15 } }
    : { weightPreset: "planned", cascadeStrategy: "sequential", expiryMinutes: 120, escalationThreshold: { type: "contacts", count: 10 } };
}
```

**Tests:** Unit tests — shift in 2hrs → urgent, shift in 8hrs → planned, URGENT flag → urgent, config returns correct values.

#### P1.1.6 — Data validator

**File:** `src/services/rostering/data-validator.ts`

Pre-flight checks in GATHERING → SCORING transition:

```typescript
export interface DataValidationResult {
  valid: boolean;
  warnings: string[];
  blockers: string[];
}

export function validateMatchInputs(visit, client, employees): DataValidationResult;
```

Blockers → skip scoring, escalate immediately with validation report.
Warnings → score with available data, attach to MatchResult.

**Tests:** Unit tests — no client_id → blocker, no employees → blocker, missing coords → warning, past start time → warning.

#### P1.1.7 — Audit logging

**File:** `src/services/rostering/audit-service.ts`

```typescript
export async function appendAudit(tx, userId, taskId, entry: Omit<AuditEntry, "timestamp">): Promise<void>;
export async function getAuditTrail(tx, userId, taskId): Promise<AuditEntry[]>;
```

Every state transition in the orchestrator calls `appendAudit()`.

**Tests:** Integration test — create task, advance through states, verify audit trail has entries for each transition.

#### P1.1.8 — API routes

**Files:**
- `app/api/v1/roster/tasks/route.ts` — POST (create) + GET (list)
- `app/api/v1/roster/tasks/[id]/route.ts` — GET (detail with audit trail)

**Handlers:**
- `src/server/commands/roster/create-roster-task.ts`
- `src/server/queries/roster/list-roster-tasks.ts`
- `src/server/queries/roster/get-roster-task.ts`

All follow existing pattern: `traceId → requireAuthContext(req, traceId) → makeDeps() → handler → Response.json()`

**Zod validation:** `CreateRosterTaskInput` on POST body, `RosterTaskStatusFilter` on GET query params.

**Tests:** Integration tests — create task via API, list tasks, get task detail with audit trail.

#### P1.1.9 — Client hook

**File:** `src/hooks/use-roster-tasks.ts`

```typescript
export function useRosterTasks(filter?): UseQueryResult;
export function useRosterTask(taskId): UseQueryResult;
export function useCreateRosterTask(): UseMutationResult;  // optimistic update
```

**Tests:** Unit tests — hook calls correct endpoints, handles loading/error states.

#### P1.1.10 — Event processor (two-phase webhook → RosterTask)

**File:** `src/server/commands/roster/process-pending-events.ts`

Implements Phase 2 of the two-phase pattern (see "Two-Phase Webhook → RosterTask Pattern" above). Webhook handlers stay stateless — they compute scoring + recommendation and return results stored in `workflow_events.result`. This handler reads those completed events and creates user-scoped RosterTasks within UoW.

```typescript
export async function handleProcessPendingEvents(
  deps: { uow: UnitOfWork },
  _rawInput: unknown,
  ctx: AuthContext,
): Promise<{ processed: number; tasks: string[] }> {
  // UoW usage: deps.uow.run(ctx, async (txCtx) => { ... txCtx.db ... })
  // 1. Query workflow_events for completed events with results
  //    that don't yet have a corresponding roster_task (source_event_id match)
  //    NOTE: verify actual status value set by existing handlers (may be "processed" not "completed")
  // 2. For each unprocessed event:
  //    - Create RosterTask with user_id = ctx.principalId, source_event_id = event.event_id
  //    - Copy match_result + llm_recommendation from workflow_events.result
  //    - Set initial status based on result (e.g., "reasoning" if scoring+LLM already done)
  //    - Append audit entry
  // 3. Advance each new task: advanceTask(deps, ctx, taskId)
  // 4. Return count of processed events
}
```

**File:** `app/api/v1/roster/process-events/route.ts`

```typescript
export async function POST(req: Request) {
  const traceId = crypto.randomUUID();
  try {
    const ctx = await requireAuthContext(req, traceId);
    const result = await handleProcessPendingEvents(makeDeps(), undefined, ctx);
    return Response.json(result);
  } catch (err) {
    return handleAppError(err, traceId);
  }
}
```

**Why not extend webhook handlers directly:** Webhook handlers have signature `(event, traceId)` — no `deps`, no `ctx`, no `UoW`. RLS requires `auth.uid()` set via UoW JWT claims. Changing the webhook handler contract would break the existing stateless dispatcher pattern. The two-phase approach keeps webhooks as pure compute and adds user-scoped persistence in a separate, authenticated step.

**Tests:** Integration test — insert completed workflow_events with results → call process-events → verify RosterTasks created with correct user_id and source_event_id → verify duplicate events not reprocessed.

#### P1.1.11 — Dashboard auto-processing hook

**File:** `src/hooks/use-roster-tasks.ts` (add)

```typescript
export function useProcessEvents(): UseMutationResult;
// Called on roster page mount — triggers POST /api/v1/roster/process-events
// Invalidates ["roster-tasks"] query key on success
```

This ensures new webhook events are processed into RosterTasks whenever the user views the roster page.

### P1.1 Deliverables
- 3 new DB tables with RLS + optimistic locking (`version` column)
- Rollback script prepared (`012_drop_roster_tables.sql`)
- Drizzle schema for all 3 tables
- State machine advancing detected → gathering → scoring → reasoning → completed (dry-run)
- Data validation preventing bad scoring inputs
- 4 API routes (POST create + 2 GET + POST process-events)
- Client hooks for task CRUD + event processing
- Two-phase webhook→RosterTask pattern (events processed via authenticated endpoint)
- Audit trail for every state transition

### P1.1 Test Strategy
- ~15 unit tests: types/schemas, urgency classifier, data validator, optimistic lock helper
- ~18 integration tests: CRUD, state machine pipeline, API routes, process-events, duplicate prevention
- Create `src/test/fixtures/roster-test-helpers.ts` with mock factories:
  - `createMockMatchResult()` — returns valid `MatchResult` with configurable candidates
  - `createMockRecommendation()` — returns valid `LLMRecommendation` with configurable escalation
  - `createMockContactAttempt()` — returns valid `ContactAttempt`
  - `createMockWorkflowEvent()` — returns completed `workflow_events` row with result
- Use `vi.mock()` for `computeMatch`, `getRecommendation`, `alayaFetch` in orchestrator unit tests
- Reserve real-service integration tests (mock-alaya + Bedrock) for E2E in P1.8
- Target: ~33 new tests

---

## Sprint P1.2: LLM Reasoning Service Integration (2 weeks)

### Goal
Tighter integration of existing reasoning service with orchestrator. Structured escalation flow. Explainable recommendations stored on task record.

### Prerequisites
- P1.1 complete (orchestrator, task persistence)

### Tasks

#### P1.2.1 — Reasoning integration in orchestrator

The orchestrator's `scoring → reasoning` transition already calls `getRecommendation()` (from P1.1.4). This sprint refines:
- Pass urgency context to reasoning service
- Store full `LLMRecommendation` as JSONB on task record
- Store `factors_considered` and `trade_offs` for UI display

**File:** `src/services/rostering/workflow-orchestrator.ts` (update `reasonAboutMatch()`)

**Tests:** Integration test — verify LLMRecommendation stored correctly with all fields.

#### P1.2.2 — Escalation decision flow

**File:** `src/services/rostering/workflow-orchestrator.ts` (update `initiateContact()`)

Route based on `should_escalate` + `urgency`:
- `should_escalate: true, urgency: "immediate"` → skip to ESCALATED (human must act now)
- `should_escalate: true, urgency: "before_shift"` → CONTACTING with escalation flag (try contact + alert human)
- `should_escalate: true, urgency: "informational"` → CONTACTING with note (log for review)
- `should_escalate: false` → CONTACTING normally

**Tests:** Unit tests for each escalation path (4 test cases).

#### P1.2.3 — Recommendation context enrichment

**File:** `src/services/recommendation-context.ts` (extend existing)

Add urgency context, task history (previous attempts for same visit), and data validation warnings to the context passed to the LLM.

**Tests:** Unit tests — context includes urgency, warnings passed through.

#### P1.2.4 — Error handling for LLM failures

When `getRecommendation()` fails (Bedrock timeout, malformed response):
- Log error with traceId
- Fall back to scoring-only mode: recommend top scored candidate without LLM explanation
- Set `llm_recommendation` to error record with `{ error: true, reason: "..." }`
- Continue to CONTACTING (don't block on LLM failure)

**Tests:** Unit test — mock LLM failure → task advances to CONTACTING with top scored candidate.

### P1.2 Deliverables
- Escalation decision flow (4 paths)
- LLM failure fallback
- Enriched recommendation context
- ~12 new tests

---

## Sprint P1.3: SMS Communication (2 weeks)

### Goal
Full SMS loop: send offer → receive response → advance task. Expiry triggers cascade.

### Prerequisites
- P1.2 complete (escalation flow)
- No external accounts needed — mock-first approach (P12 decision)

### Environment Variables (new)

```env
# SMS Provider (Twilio) — not needed until go-live
# TWILIO_ACCOUNT_SID=
# TWILIO_AUTH_TOKEN=
# TWILIO_FROM_NUMBER=+61...
# TWILIO_WEBHOOK_SECRET=

# Feature flag — routes to MockSMSProvider when false (default)
SMS_ENABLED=false
```

### Tasks

#### P1.3.1 — Communication types

**File:** `src/services/communication/types.ts`

```typescript
export interface SMSProvider {
  send(to: string, body: string): Promise<{ messageId: string }>;
  verifyWebhook(req: Request): Promise<boolean>;
}

export interface EmailProvider {
  send(options: { to: string; subject: string; body: string; html?: string }): Promise<{ messageId: string }>;
}

export interface MessageTemplate {
  subject?: string;
  body: string;
  variables: Record<string, string>;
}
```

**Tests:** Type-level — no runtime tests needed.

#### P1.3.2 — SMS provider (mock-first)

**File:** `src/services/communication/sms-provider.ts`

```typescript
// Primary implementation for development — logs messages via structured logger.
// NOTE: In-memory state does NOT persist across serverless invocations.
// For dev visibility, the communication dispatcher writes sent messages to the
// audit trail (appendAudit) so they're visible in the DB, not just in-memory.
// The simulation responder works independently — it takes explicit input
// (taskId, phoneNumber, message), not reading from this provider.
export class MockSMSProvider implements SMSProvider {
  async send(to: string, body: string): Promise<{ messageId: string }> {
    const messageId = `mock_${crypto.randomUUID()}`;
    logger.info("mock-sms-sent", { to, messageId, bodyLength: body.length });
    return { messageId };
  }

  async verifyWebhook(req: Request): Promise<boolean> {
    return true; // Always valid in mock mode
  }
}

// Real implementation — deferred to go-live sprint
export class TwilioSMSProvider implements SMSProvider {
  async send(to: string, body: string): Promise<{ messageId: string }>;
  async verifyWebhook(req: Request): Promise<boolean>;
}
```

Provider selected based on `SMS_ENABLED` env var: `false` → `MockSMSProvider` (default), `true` → `TwilioSMSProvider`.

**Implementation order:** Build and test entire SMS flow with `MockSMSProvider`. `TwilioSMSProvider` is a stub until go-live.

**Tests:** Unit tests — mock send success, mock send stores message, provider factory selects correct implementation.

#### P1.3.3 — Message templates

**File:** `src/services/communication/templates.ts`

```typescript
export function buildShiftOfferSMS(params: {
  name: string; client: string; date: string; time: string; expiryMinutes: number;
}): string;
// → "Hi {name}, shift available: {client} on {date} {time}. Reply YES to accept or NO to decline. Expires in {expiry}."

export function buildConfirmationSMS(params: { name: string; client: string; date: string; time: string }): string;
export function buildCancellationSMS(params: { name: string; reason: string }): string;
```

**Tests:** Unit tests — template output matches expected format, all variables substituted.

#### P1.3.4 — Communication dispatcher

**File:** `src/services/communication/dispatcher.ts`

```typescript
export async function dispatchContact(
  task: RosterTask,
  candidate: ScoredCandidate,
  channel: ContactChannel,
  provider: SMSProvider | EmailProvider,
): Promise<ContactAttempt>;
```

Creates `ContactAttempt`, sends message, updates task contacts array.

**Tests:** Unit tests — dispatches to correct provider, creates ContactAttempt with correct fields.

#### P1.3.5 — Inbound SMS webhook + simulation responder

**File:** `app/api/v1/webhooks/sms/route.ts`

```typescript
export async function POST(request: Request) {
  // 1. Verify signature (Twilio in prod, always-pass in mock mode)
  // 2. Extract sender phone + message body
  // 3. Look up active ContactAttempt by phone number
  // 4. Parse response via LLM (not just YES/NO)
  // 5. Update ContactAttempt + advance task
}
```

**File:** `src/server/commands/webhooks/handle-sms-response.ts`

**Simulation responder (mock-first, P12 decision):**

**File:** `app/api/v1/dev/simulate-response/route.ts`

```typescript
// Development-only endpoint — simulates caregiver responding to an SMS offer
// Guards: only available when SMS_ENABLED=false AND NODE_ENV !== "production"
// Returns 404 (not 403) when guarded — don't reveal endpoint exists
export async function POST(request: Request) {
  // 0. Guard: if SMS_ENABLED=true OR NODE_ENV=production → return 404
  // 1. requireAuthContext (user-scoped, not M2M)
  // 2. Validate input: { taskId, phoneNumber, message } (e.g., "yes", "no", "what time?")
  // 3. Route through same handle-sms-response handler as real webhook
  // 4. Return updated task state
}
```

This enables full end-to-end testing of the SMS flow without Twilio:
1. `advanceTask()` reaches CONTACTING → `MockSMSProvider.send()` logs the outbound message
2. Developer/tester calls `POST /api/v1/dev/simulate-response` with caregiver's "reply"
3. Response flows through `handle-sms-response` → `parseResponse()` → task advances

**Go-live RLS note:** The real Twilio inbound webhook (`POST /api/v1/webhooks/sms`) is M2M — no user auth, no UoW, no `auth.uid()`. But updating `roster_tasks` requires RLS. At go-live, this needs the same two-phase treatment as the AlayaCare webhook (P9 decision): store the inbound response in an intermediate table (e.g., `pending_sms_responses` or reuse `workflow_events`), then process during the user's authenticated session or via the process-events endpoint. The simulation responder sidesteps this because it is user-authenticated.

**Tests:** Integration tests — YES response → task advances to ACCEPTED, NO response → decline logged, question → follow-up triggered. All tests use simulation responder (no Twilio dependency).

#### P1.3.6 — Response handler (LLM-parsed)

**File:** `src/services/communication/response-handler.ts`

```typescript
export async function parseResponse(message: string): Promise<{
  intent: "accept" | "decline" | "question";
  confidence: number;
  decline_reason?: string;
  question?: string;
}>;
```

**Two-tier parsing strategy — keyword-first, LLM-fallback:**

1. **Keyword matching (fast, no LLM cost):** Check for exact/near-exact matches first:
   - Accept: `yes`, `yep`, `sure`, `ok`, `accept`, `confirm`, `y`
   - Decline: `no`, `nope`, `decline`, `can't`, `busy`, `n`
   - If keyword match with high confidence → return immediately (no LLM call)

2. **LLM classification (fallback for ambiguous messages):** Only invoke Bedrock when keyword matching fails or confidence is low. Uses a simple classification prompt. Handles conversational responses ("yeah sure I can do that" → accept, "sorry I'm busy but can do next week" → decline, "what time does it start?" → question).

```typescript
export async function parseResponse(message: string): Promise<ParsedResponse> {
  // Step 1: Try keyword matching first (no LLM cost, <1ms)
  const keywordResult = matchKeywords(message.trim().toLowerCase());
  if (keywordResult && keywordResult.confidence >= 0.9) return keywordResult;

  // Step 2: Fall back to LLM for ambiguous messages
  return classifyWithLLM(message);
}
```

**Why keyword-first:** SMS responses are typically short ("yes", "no"). LLM classification adds ~1-3s latency and Bedrock cost per response. Keyword matching handles ~80% of responses instantly. LLM is reserved for genuinely ambiguous messages where natural language understanding is needed.

**Tests:** Unit tests — keyword matches (yes/no/y/n), LLM fallback for ambiguous messages, various natural language responses classified correctly.

#### P1.3.7 — Expiry handling

**File:** `src/services/rostering/cascade-engine.ts` (initial implementation)

```typescript
export function isContactExpired(contact: ContactAttempt): boolean;
export async function handleExpiry(tx, userId, task: RosterTask): Promise<RosterTask>;
```

Mark expired contacts, advance task to CASCADING.

**Expiry check mechanism:** Called when `advanceTask()` enters CONTACTING state — checks if current contact has expired. Production enhancement: scheduled job to sweep expired contacts.

**Tests:** Unit tests — contact past expiry → marked expired, task transitions to CASCADING.

#### P1.3.8 — Orchestrator CONTACTING integration

Update orchestrator's `initiateContact()` to use communication dispatcher instead of dry-run logging.

**Tests:** Integration test — task reaches CONTACTING → SMS sent (mock provider) → response received → task advances.

### P1.3 Deliverables
- SMS provider abstraction + `MockSMSProvider` (primary) + `TwilioSMSProvider` (stub for go-live)
- Message templates (offer, confirmation, cancellation)
- Communication dispatcher
- Inbound SMS webhook with LLM response parsing (keyword-first)
- Simulation responder API (`POST /api/v1/dev/simulate-response`) for testable end-to-end flow
- Expiry handling
- Full SMS loop: send (mock) → simulate response → advance
- ~25 new tests (all using mock providers, no external dependencies)

---

## Sprint P1.4: Cascade Engine & Operations Dashboard (2 weeks)

### Goal
Full cascade logic for planned + urgent shifts. Dashboard shows real-time task status.

### Prerequisites
- P1.3 complete (SMS communication)

### Tasks

#### P1.4.1 — Sequential cascade

**File:** `src/services/rostering/cascade-engine.ts` (extend)

```typescript
export async function advanceCascade(tx, userId, task: RosterTask): Promise<RosterTask>;
```

Sequential: Contact #1 → wait expiry (2hrs) → Contact #2 → ... One at a time.

**Tests:** Unit tests — after expiry, next candidate contacted. After all candidates exhausted → ESCALATED.

#### P1.4.2 — Parallel cascade

Parallel: Contact top 5 simultaneously. First accept wins, cancel others immediately.

**Tests:** Unit tests — 5 contacts sent simultaneously, first accept → others cancelled, task → ACCEPTED.

#### P1.4.3 — Escalation trigger

After top 10 contacts exhausted (sequential) or 15 minutes with no response (parallel) → ESCALATED.

**Tests:** Unit tests — sequential exhaustion, parallel timeout, both paths.

#### P1.4.4 — Operations dashboard page

**File:** `app/(app)/roster/page.tsx`

Active roster tasks list with:
- Status filter tabs (All, Active, Escalated, Completed)
- Task cards showing visit info, status, urgency, current contact
- Auto-refresh via `refetchInterval: 30_000` (30s polling — balances responsiveness with server load)

**File:** `components/rostering/task-card.tsx`

Summary card: visit details, status badge, urgency indicator, time elapsed, current contact status.

**File:** `components/rostering/activity-feed.tsx`

Live activity stream showing recent state transitions.

#### P1.4.5 — Dashboard metrics summary

**File:** `app/(app)/dashboard/page.tsx` (extend existing)

Add rostering metrics alongside existing AlayaCare metrics:
- Active tasks count
- Time-to-fill average (today)
- Fill rate today
- Escalation count

**File:** `src/hooks/use-roster-tasks.ts` (extend with summary query)

#### P1.4.6 — Sidebar navigation

**File:** `components/app-sidebar.tsx` (extend)

Add navigation items:
- Roster (icon: `ListTodo`) → `/roster`
- Escalations (icon: `AlertTriangle`) → `/escalations`
- Analytics (icon: `BarChart3`) → `/analytics`

**File:** `components/page-breadcrumbs.tsx` (extend `ROUTE_LABELS`)

Add: `roster: "Roster"`, `escalations: "Escalations"`, `analytics: "Analytics"`

### P1.4 Deliverables
- Sequential + parallel cascade strategies
- Escalation triggers (contacts exhausted, timeout)
- Roster tasks list page with filtering
- Activity feed component
- Dashboard enhanced with rostering metrics
- Sidebar navigation updated
- ~15 new tests (cascade logic) + UI components

---

## Sprint P1.5: Escalation Console & Assignment Write-Back (2 weeks)

### Goal
Humans can intervene via escalation console. Accepted shifts written back to AlayaCare.

### Prerequisites
- P1.4 complete (cascade engine, dashboard)

### Tasks

#### P1.5.1 — Escalation console UI

**File:** `app/(app)/escalations/page.tsx`

Prioritised queue with:
- Urgent first, then planned, then low priority
- Each entry: shift details, LLM recommendation + explanation, scored candidates, contact history
- Quick actions: Accept Recommendation, Assign Manually, Defer, Take Over

**File:** `components/rostering/escalation-card.tsx`

Full escalation item with recommendation display, candidate list, action buttons.

**File:** `components/rostering/candidate-list.tsx`

Scored candidates with dimension breakdowns and [Assign] buttons.

**File:** `components/rostering/score-bar.tsx`

Visual score indicator (████░░░░).

#### P1.5.2 — Human action handler

**File:** `src/server/commands/roster/handle-human-action.ts`

```typescript
export type HumanAction =
  | { action: "accept_recommendation" }
  | { action: "assign_manually"; employee_id: number }
  | { action: "defer" }
  | { action: "take_over" }
  | { action: "cancel"; reason: string };

export async function handleHumanAction(deps, input: { taskId: string; action: HumanAction }, ctx): Promise<RosterTask>;
```

Actions:
- **Accept recommendation** → task returns to CONTACTING (contact LLM's pick)
- **Assign manually** → bypass LLM, go directly to AlayaCare write-back
- **Defer** → keep in escalation queue, no state change
- **Take over** → task exits autonomous flow, marked as human-managed
- **Cancel** → task → CANCELLED with reason

Each action appends audit entry with actor = ctx.principalId.

**Zod schema:**
```typescript
export const HumanActionInput = z.object({
  action: z.enum(["accept_recommendation", "assign_manually", "defer", "take_over", "cancel"]),
  employee_id: z.number().int().positive().optional(),
  reason: z.string().optional(),
}).refine(
  (d) => d.action !== "assign_manually" || d.employee_id != null,
  { message: "employee_id required for assign_manually" }
).refine(
  (d) => d.action !== "cancel" || d.reason != null,
  { message: "reason required for cancel" }
);
```

**Tests:** Unit tests for each action type (5 test cases) + validation tests.

#### P1.5.3 — PATCH API route

**File:** `app/api/v1/roster/tasks/[id]/route.ts` (add PATCH)

**File:** `app/api/v1/roster/escalations/route.ts` (add GET)

**File:** `src/server/queries/roster/list-escalations.ts`

```typescript
// Escalated tasks sorted by urgency (urgent first) then detected_at (oldest first)
export async function listEscalations(deps, ctx): Promise<RosterTask[]>;
```

**File:** `src/hooks/use-escalations.ts`

```typescript
export function useEscalations(): UseQueryResult;
export function useHumanAction(): UseMutationResult;  // optimistic update
```

**Tests:** Integration tests — PATCH with each action type, GET escalations list.

#### P1.5.4 — AlayaCare write-back

**File:** `src/services/rostering/workflow-orchestrator.ts` (update `assignInAlayaCare()`)

On acceptance:
1. `POST /scheduler/visits/{visit_id}/offers` via `alayaFetch()` with `employee_id`
2. Update task → ASSIGNED → COMPLETED
3. Calculate `time_to_fill_ms = resolved_at - detected_at`
4. Append audit entry

**Tests:** Integration test (mock `alayaFetch`) — accepted task writes back, calculates time-to-fill.

#### P1.5.5 — Escalation auto-triggers

Extend orchestrator to auto-escalate when:
- No acceptance after N cascade attempts (configurable)
- Fewer than 3 viable candidates from scoring
- Data validation had blockers
- LLM confidence = "low" on all candidates

**Tests:** Unit tests — each auto-escalation condition triggers correctly.

### P1.5 Deliverables
- Escalation console UI with prioritised queue
- 5 human action types with Zod validation
- AlayaCare write-back on acceptance
- Auto-escalation triggers
- 2 new API routes (PATCH + GET escalations)
- ~20 new tests

**Known gap:** No roster policy layer — any authenticated user can perform any action. Acceptable for single-user MVP. Extend `makeDeps()` with roster policies when multi-user is needed.

---

## Sprint P1.6: Webhook Extensions & Email Integration (2 weeks)

### Goal
Extend existing webhook handlers for full lifecycle. Email-based shift handover flow.

### Prerequisites
- P1.5 complete (write-back, escalation)
- No external accounts needed — mock-first approach (P12 decision)

### What's Already Built
- Webhook receiver route ✅ (`app/api/v1/webhooks/alayacare/route.ts`)
- Event dispatcher ✅ (`src/lib/alayacare-events/dispatcher.ts`)
- 5 event handlers ✅ (`src/server/commands/webhooks/`)
- M2M auth ✅ (`validateWebhookSecret()`)
- Idempotency ✅ (`workflow_events` table)

### Environment Variables (new)

```env
# Email Provider — not needed until go-live
# EMAIL_PROVIDER=ses            # "ses" or "sendgrid"
# SES_REGION=ap-southeast-2
# SES_FROM_ADDRESS=dappaai@dovida.com.au
# Or: SENDGRID_API_KEY=

# Feature flag — routes to MockEmailProvider when false (default)
EMAIL_ENABLED=false
```

### Tasks

#### P1.6.1 — Extend webhook handlers for full lifecycle

**Files:** `src/server/commands/webhooks/` (extend existing)

Currently all handlers log events. Extend to trigger orchestrator actions:

| Handler | Current | Phase 1 Extension |
|---------|---------|-------------------|
| `handle-visit-vacated` | Logs + scores + recommends | Stores result in `workflow_events.result` → processed into RosterTask by P1.1.10 (two-phase, P9) |
| `handle-visit-created` | Logs event | If status=vacant → same as visit.vacated |
| `handle-employee-status-changed` | Logs event | If terminated → find active tasks for this employee → re-score |
| `handle-employee-unavailability` | Logs event | Find active tasks with affected employee in contacts → advance cascade |
| `handle-client-created` | Logs event | No action needed (informational) |

**New handlers to register:**
- `visit.cancelled` → cancel active RosterTask for this visit → notify contacted caregivers
- `visit.updated` → re-score if material change (time, requirements)

**Tests:** Integration tests for each handler extension.

#### P1.6.2 — Email provider (mock-first)

**File:** `src/services/communication/email-provider.ts`

```typescript
// Primary implementation for development — logs emails + stores in memory
export class MockEmailProvider implements EmailProvider {
  private sentEmails: Array<{ to: string; subject: string; body: string; messageId: string; sentAt: Date }> = [];

  async send(options): Promise<{ messageId: string }> {
    const messageId = `mock_email_${crypto.randomUUID()}`;
    this.sentEmails.push({ ...options, messageId, sentAt: new Date() });
    logger.info("mock-email-sent", { to: options.to, subject: options.subject, messageId });
    return { messageId };
  }

  getSentEmails() { return this.sentEmails; }
}

// Real implementation — deferred to go-live sprint
export class SESEmailProvider implements EmailProvider {
  async send(options): Promise<{ messageId: string }>;
}
```

Provider selected based on `EMAIL_ENABLED` env var: `false` → `MockEmailProvider` (default), `true` → `SESEmailProvider`.

**Tests:** Unit tests — mock send stores email, provider factory selects correct implementation.

#### P1.6.3 — Inbound email parsing

**File:** `src/services/communication/email-parser.ts`

Uses existing Bedrock client to extract structured data from free-text handover emails:

```typescript
export async function parseHandoverEmail(emailBody: string): Promise<{
  shift_details: { client_name?: string; date?: string; time?: string; requirements?: string };
  confidence: number;
  raw_text: string;
}>;
```

**File:** `app/api/v1/webhooks/email/route.ts`

Receives inbound email (from SES or SendGrid webhook), parses → creates confirmation email → on human confirmation → creates RosterTask.

**Tests:** Unit tests — various email formats parsed correctly.

#### P1.6.4 — Outbound email

**File:** `src/services/communication/templates.ts` (extend)

```typescript
export function buildDailySummaryEmail(metrics): { subject: string; html: string };
export function buildWeeklyReportEmail(metrics): { subject: string; html: string };
export function buildShiftOfferEmail(params): { subject: string; html: string };
```

**Tests:** Unit tests — template renders correctly.

#### P1.6.5 — Trigger detector (polling fallback)

**File:** `src/services/rostering/trigger-detector.ts`

Polling fallback for when webhooks are unavailable:

```typescript
export async function detectNewTriggers(tx, userId): Promise<{ newVisits: number[]; modifiedVisits: number[] }>;
```

Checks AlayaCare for new/modified visits since last poll.

**Scheduling mechanism decision:** Vercel Cron (if deployed on Vercel) or Supabase `pg_cron`. Same mechanism reused for P1.7.3 (daily metrics) and P1.8.2 (pattern recognition).

**Tests:** Unit tests — detects new visits, ignores already-tracked visits.

### P1.6 Deliverables
- Extended webhook handlers for full lifecycle
- Email provider abstraction + `MockEmailProvider` (primary) + `SESEmailProvider` (stub for go-live)
- Inbound email parsing via LLM
- Outbound email templates (daily summary, weekly report, shift offer)
- Polling fallback trigger detector
- 2 new webhook routes (visit.cancelled, email)
- ~20 new tests (all using mock providers, no external dependencies)

---

## Sprint P1.7: Audit Trail, Analytics & Conversational UI (2 weeks)

### Goal
Full transparency and analytics. Read-only chat queries.

### Prerequisites
- P1.6 complete (full lifecycle)

### Tasks

#### P1.7.1 — Audit trail UI

**File:** `app/(app)/roster/[id]/page.tsx`

Task detail page with:
- Task summary (visit, client, status, urgency, timing)
- LLM recommendation card (explanation, factors, trade-offs)
- Contact history timeline
- Audit log timeline

**File:** `components/rostering/task-detail.tsx`
**File:** `components/rostering/audit-timeline.tsx`

Searchable/filterable audit log:

```typescript
export const AuditQuery = z.object({
  task_id: z.string().uuid().optional(),
  visit_id: z.number().int().positive().optional(),
  employee_id: z.number().int().positive().optional(),
  action: z.string().optional(),
  actor: z.string().optional(),
  from_date: z.string().datetime().optional(),
  to_date: z.string().datetime().optional(),
});
```

**File:** `app/api/v1/roster/audit/route.ts`
**File:** `src/server/queries/roster/search-audit-log.ts`
**File:** `src/hooks/use-roster-audit.ts`

**Tests:** Integration test — audit search with various filters.

#### P1.7.2 — Analytics dashboard

**File:** `app/(app)/analytics/page.tsx`
**File:** `components/rostering/analytics-charts.tsx`

30-day rolling metrics:
- Autonomous fill rate
- Average time-to-fill
- First-contact acceptance rate
- Escalation rate
- Fill rate by shift type (planned vs urgent)
- Agent vs human performance comparison

**File:** `app/api/v1/roster/analytics/route.ts`
**File:** `src/server/queries/roster/get-analytics.ts`
**File:** `src/hooks/use-roster-analytics.ts`

**Tests:** Unit tests — metrics calculations, query with date range.

#### P1.7.3 — Daily metrics materialisation

**File:** `src/services/rostering/metrics-service.ts`

```typescript
export async function materialiseDailyMetrics(tx, userId, date: string): Promise<void>;
```

Aggregates from completed `roster_tasks`:
- `tasks_created` — count for date
- `tasks_filled_autonomous` — completed without escalation
- `tasks_escalated` — escalated count
- `avg_time_to_fill_ms` — average of `time_to_fill_ms`
- `first_contact_acceptance_rate` — percentage where first contact accepted

**Scheduling:** Uses mechanism decided in P1.6.5 (Vercel Cron or `pg_cron`). Runs daily at midnight AEST.

**Tests:** Integration test — create completed tasks → run materialisation → verify metrics.

#### P1.7.4 — Conversational interface (read-only)

**File:** `app/(app)/chat/page.tsx` (reinstate — currently deleted)

**Pre-requisite audit:** The chat page, its API routes (`/api/v1/chat/`), and supporting hooks (`use-chat.ts`) were deleted in the current branch. Before rebuilding, audit the deleted files to determine what can be reused vs. what needs rewriting:
- Check `git show HEAD:app/(app)/chat/page.tsx` for the old chat page component
- Check `git show HEAD:app/api/v1/chat/` for the old API routes (stream, conversations, messages)
- Check `git show HEAD:src/hooks/use-chat.ts` for the old hooks
- Determine whether old chat DB tables (`chatConversations`, `chatMessages`) are still present in schema
- Rebuild chat infrastructure with rostering tool-use from the start (don't retrofit old general-purpose chat)

Extends existing LLM infrastructure (`src/lib/llm/`, `src/lib/sse.ts`) with rostering-specific LLM tool use for **read-only queries only**:

- "Is Sarah available Thursday?" → query AlayaCare visits for Sarah on Thursday
- "Status of task #47?" → query roster_tasks
- "How many shifts were filled today?" → query metrics

**Implementation:** LLM tool use (function calling) with tools:
```typescript
const ROSTERING_TOOLS = [
  { name: "check_availability", params: { employee_name: string, date: string } },
  { name: "get_task_status", params: { task_id: string } },
  { name: "query_metrics", params: { metric: string, date_range?: string } },
  { name: "find_candidates", params: { visit_id: number } },
];
```

Write actions (create task, assign caregiver via chat) deferred to P1.8.

**Tests:** Integration tests — tool use flow with mock LLM.

#### P1.7.5 — Sidebar + breadcrumbs for chat

**File:** `components/app-sidebar.tsx` (extend)

Re-add Chat navigation item (icon: `MessageSquare`) → `/chat`

**File:** `components/page-breadcrumbs.tsx`

Re-add `chat: "Chat"` to ROUTE_LABELS.

### P1.7 Deliverables
- Task detail page with audit timeline
- Searchable audit log (API + UI)
- Analytics dashboard with 6 metrics
- Daily metrics materialisation job
- Conversational interface (read-only queries)
- Chat reinstated in sidebar
- 2 new API routes (GET analytics, GET audit)
- ~15 new tests

---

## Sprint P1.8: Learning, Polish & Launch Preparation (2 weeks)

### Goal
Learning system active. Conversational write actions. Full E2E test suite. Production deployment package.

### Prerequisites
- P1.7 complete (analytics, conversational UI)

### Tasks

#### P1.8.1 — Outcome tracking

Record every completed task's outcomes for learning:
- Caregivers contacted and responses
- Time to fill
- Human intervention required
- Post-assignment outcomes (if available via AlayaCare: attendance, incidents)

Already captured in task record and audit log. This task adds:

**File:** `src/services/rostering/outcome-tracker.ts`

```typescript
export interface TaskOutcome {
  task_id: string;
  total_contacts: number;
  accepted_at_rank: number;           // Which rank accepted (1 = first contact)
  time_to_fill_ms: number;
  human_intervention: boolean;
  cascade_rounds: number;
  urgency: Urgency;
}

export function extractOutcome(task: RosterTask): TaskOutcome;
```

**Tests:** Unit tests — extract outcomes from various completed tasks.

#### P1.8.2 — Pattern recognition

**File:** `src/services/rostering/pattern-recognition.ts`

Scheduled analysis (daily/weekly):

```typescript
export async function analysePatterns(tx, userId): Promise<PatternInsight[]>;

export interface PatternInsight {
  type: "always_declines" | "never_accepts" | "preset_performance" | "client_churn";
  description: string;
  evidence: Record<string, unknown>;
  recommendation: string;
}
```

Patterns detected:
- Caregiver always declines certain shift times
- Caregiver marked available but never accepts (anomaly)
- Certain weight preset outperforms others
- Client has high caregiver churn (many unique caregivers)

Uses scheduling mechanism from P1.6.5.

**Tests:** Unit tests — each pattern type detected from test data.

#### P1.8.3 — Acceptance feedback loop

**File:** `src/services/scoring/score-acceptance.ts` (extend existing)

Supplement PoC 1 acceptance likelihood scorer with DappaAi's own contact outcomes:

```typescript
// Current: score based on AlayaCare historical offers only
// Extended: merge AlayaCare history with DappaAi contact outcomes
// Weight recent DappaAi data higher than older AlayaCare data
export function scoreAcceptance(
  employeeId: number,
  offers: VisitOffer[],
  dappaAiOutcomes?: ContactOutcome[],  // NEW
): DimensionResult;
```

**Tests:** Unit tests — DappaAi outcomes influence score, recency weighting applied.

#### P1.8.4 — Conversational write actions

**File:** Chat tools extension (from P1.7.4)

Add write tools with confirmation step:

```typescript
const WRITE_TOOLS = [
  { name: "create_roster_task", params: { visit_id?: number, description: string, urgency?: string } },
  { name: "assign_caregiver", params: { task_id: string, employee_id: number } },
  { name: "cancel_task", params: { task_id: string, reason: string } },
];
```

Each write action requires confirmation:
1. LLM proposes action
2. User confirms ("Yes, assign Tom")
3. Action executed
4. Confirmation displayed

**Tests:** Integration test — create task via chat with confirmation flow.

#### P1.8.5 — End-to-end testing

Full workflow tests across all trigger types:

**File:** `src/services/rostering/__tests__/e2e-workflow.test.ts`

Scenarios:
1. **Webhook trigger** — visit.vacated → task created → scored → reasoned → contacted → accepted → assigned → completed
2. **Manual trigger** — POST /api/v1/roster/tasks → same pipeline
3. **Escalation flow** — low confidence → escalated → human assigns → completed
4. **Cascade flow** — first contact declines → cascade to #2 → accepted
5. **Parallel cascade** — urgent shift → 5 contacts → first accept → others cancelled
6. **Expiry flow** — contact expires → cascade → escalate after N attempts
7. **Cancel flow** — visit cancelled during contacting → task cancelled → contacted caregiver notified

**Tests:** ~10 end-to-end scenario tests.

#### P1.8.6 — Performance & load testing

Validate with realistic employee pool sizes:

**File:** `src/services/rostering/__tests__/performance.test.ts`

- Scoring with 150+ candidates: target <500ms
- Full pipeline (scoring + reasoning): target <5s
- Concurrent task advancement: 10 tasks simultaneously
- Dashboard query with 1000+ tasks: target <200ms

**Tests:** ~5 performance benchmark tests.

#### P1.8.7 — Production deployment preparation

**Go-live provider cutover** (mock → real):
- [ ] Sign up for Twilio — get phone number, configure inbound SMS webhook URL
- [ ] Implement `TwilioSMSProvider.send()` and `TwilioSMSProvider.verifyWebhook()` (stub exists from P1.3.2)
- [ ] Sign up for email provider (SES or SendGrid) — configure domain verification
- [ ] Implement `SESEmailProvider.send()` (stub exists from P1.6.2)
- [ ] Set `SMS_ENABLED=true`, `EMAIL_ENABLED=true` in production environment
- [ ] Test real SMS send + receive with a test phone number
- [ ] Test real email send with a test address
- [ ] Remove or gate `/api/v1/dev/simulate-response` endpoint (dev-only, must not be accessible in production)
- [ ] Implement two-phase pattern for real inbound SMS webhook (M2M → intermediate table → user-scoped processing), same as AlayaCare webhook (P9 decision)

**Infrastructure checklist:**
- [ ] AlayaCare sandbox → production URL swap (verify `ALAYACARE_API_URL`)
- [ ] Verify single-tenant user can log in and process events (two-phase pattern uses logged-in user's ID)
- [ ] Rate limiting on webhook routes (Vercel edge config or middleware)
- [ ] Monitoring: error alerts on task failures, SLA alerts on time-to-fill
- [ ] `LOG_LEVEL=info` in production
- [ ] Verify RLS policies enforced (switch from `postgres` to `mayfly_app` role)
- [ ] Load test with production-scale data

### P1.8 Deliverables
- Outcome tracking and pattern recognition
- Acceptance feedback loop (scoring engine enhancement)
- Conversational write actions with confirmation
- ~10 E2E scenario tests + ~5 performance tests
- Production deployment checklist
- ~25 new tests

---

## Sandbox Transition Checkpoint

When AlayaCare sandbox access arrives (from Dovida), insert this checkpoint regardless of current sprint:

| Step | Duration | Action |
|------|----------|--------|
| 1 | 1 day | Switch `ALAYACARE_API_URL` to sandbox, verify all reads |
| 2 | 1 day | Test write-back (create offer) in sandbox |
| 3 | 1 day | Configure real AlayaCare webhooks → verify receipt |
| 4 | 2 days | Run full E2E with real AlayaCare data |
| 5 | 1 day | Document any API differences vs mock-alaya |

---

## Cross-Cutting Concerns

### Error Handling
All new code uses existing `AppError` hierarchy:
- `ValidationError` (400) — bad input
- `NotFoundError` (404) — task/visit not found
- `ConflictError` (409) — invalid state transition
- `ExternalServiceError` (502) — AlayaCare/Twilio/LLM failures
- All errors include `traceId` in envelope

### Logging
- Every state transition logged at `info` level
- LLM calls logged at `debug` level (prompt + response)
- Communication dispatch logged at `info` level
- Errors logged at `error` level with full context

### Feature Flags
```env
SMS_ENABLED=false          # false → MockSMSProvider (logs + stores), true → TwilioSMSProvider (real sends)
EMAIL_ENABLED=false        # false → MockEmailProvider (logs + stores), true → SESEmailProvider (real sends)
ROSTER_AUTO_ADVANCE=true   # Enable/disable automatic task advancement
```

**Mock-first approach (P12):** When `SMS_ENABLED=false` / `EMAIL_ENABLED=false`, mock providers log messages and store them in memory. The simulation responder API (`POST /api/v1/dev/simulate-response`) lets developers simulate caregiver responses, enabling full end-to-end testing of the entire pipeline without external accounts. Tasks advance through the complete pipeline using mock communication — this is the primary development mode for all of Phase 1.

---

## Test Summary

| Sprint | Unit Tests | Integration Tests | Total |
|--------|-----------|------------------|-------|
| P1.1 | ~15 | ~15 | ~30 |
| P1.2 | ~8 | ~4 | ~12 |
| P1.3 | ~15 | ~10 | ~25 |
| P1.4 | ~10 | ~5 | ~15 |
| P1.5 | ~10 | ~10 | ~20 |
| P1.6 | ~12 | ~8 | ~20 |
| P1.7 | ~8 | ~7 | ~15 |
| P1.8 | ~10 | ~15 | ~25 |
| **Total** | **~88** | **~74** | **~162** |

Estimated test count at Phase 1 completion: 123 (current) + 162 = **~285 tests**.

---

## Dependencies & External Accounts

| Dependency | Required By | Status | Action |
|-----------|------------|--------|--------|
| Twilio account | Go-live only | Not needed for development | Mock-first (P12): `MockSMSProvider` used throughout P1.1–P1.8. Set up Twilio when ready for production. |
| Email provider (SES/SendGrid) | Go-live only | Not needed for development | Mock-first (P12): `MockEmailProvider` used throughout P1.1–P1.8. Set up when ready for production. |
| AlayaCare sandbox | P1.6 (optional) | Pending from Dovida | Use mock-alaya until available |
| Vercel Cron or `pg_cron` | P1.6 | Not decided | Decide based on deployment target at P1.6 sprint start |

---

## Key Design Decisions

| ID | Decision | Rationale | Sprint |
|----|----------|-----------|--------|
| P1 | Async pipeline, not long-running process | Next.js serverless constraints; state persisted to DB between steps | P1.1 |
| P2 | LLM for reasoning, not scoring | Scoring is deterministic math; LLM adds contextual interpretation | P1.2 |
| P3 | Provider-abstracted communication | SMS/email behind interfaces; swappable without workflow changes | P1.3 |
| P4 | Append-only audit log | Separate table; never modified; supports compliance | P1.1 |
| P5 | JSONB for flexible data | Schema evolves without migrations during rapid iteration | P1.1 |
| P6 | Urgency drives strategy | Single classification determines weight preset, cascade, expiry, escalation | P1.1 |
| P7 | Webhook-first, polling-fallback | Real-time triggers; polling for resilience | P1.6 |
| P8 | Local DB for task state, AlayaCare for entity data | Task lifecycle is ours; entity data stays in AlayaCare | P1.5 |
| P9 | Single-tenant user mapping (MVP) | Two-phase pattern: webhook events processed when authenticated user views dashboard; no `DEFAULT_ROSTER_USER_ID` needed — the logged-in user's `ctx.principalId` is used directly | P1.1 |
| P10 | Feature flags for communication | SMS/email disabled by default; dry-run mode for dev/test | P1.3 |
| P11 | LLM failure fallback to scoring-only | Don't block task on LLM timeout; use top scored candidate | P1.2 |
| P12 | Mock-first implementation | All SMS/email uses `MockSMSProvider`/`MockEmailProvider` during development. Real Twilio/SES integration deferred to go-live sprint. Simulation responder API (`POST /api/v1/dev/simulate-response`) enables testable end-to-end flow without external accounts. Feature flags (`SMS_ENABLED`, `EMAIL_ENABLED`) route to mock providers when `false`. | P1.3 |

---

## Sprint Dependency Graph

```
P1.1 Foundation
  │
  ├── P1.2 LLM Integration
  │     │
  │     └── P1.3 SMS Communication (mock-first — no Twilio needed)
  │           │
  │           ├── P1.4 Cascade + Dashboard
  │           │     │
  │           │     └── P1.5 Escalation + Write-Back
  │           │           │
  │           │           └── P1.6 Webhooks + Email (mock-first — no SES/SendGrid needed)
  │           │                 │
  │           │                 └── P1.7 Audit + Analytics + Chat
  │           │                       │
  │           │                       └── P1.8 Learning + Polish + Launch (→ go-live: real providers)
  │
  └── (AlayaCare sandbox — insert checkpoint when available)
```

Each sprint depends on the previous one. No parallelisation possible between sprints due to cumulative dependencies. Within each sprint, tasks can be parallelised where noted.
