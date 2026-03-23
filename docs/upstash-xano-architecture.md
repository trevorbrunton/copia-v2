# Upstash + Xano Architecture — Autonomous Rostering Engine

## Overview

This document defines the architecture for the autonomous rostering system using **Xano** as the database and CRUD backend, **Upstash** (Workflow + QStash + Redis) for durable workflow execution and infrastructure, and **Next.js** for the frontend, computational engine, and API layer.

The design follows the **mayfly-template-nextjs** patterns (three-file domain pattern, proxy fetch, HMAC session cookies) for all standard CRUD operations, while keeping algorithmic and orchestration logic in Next.js where it can be tested, version-controlled, and code-reviewed.

### Design Principles

1. **Xano owns data** — all tables, all CRUD, all simple queries
2. **Next.js owns computation** — scoring algorithms, LLM reasoning, cascade logic, validation
3. **Upstash owns infrastructure** — durable execution, message delivery, rate limiting, caching
4. **Template patterns for CRUD** — three-file domain pattern (schema → API → hooks) for all standard data access
5. **Custom routes for engine** — webhook handlers and workflow endpoints bypass the proxy for direct control

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
│  │  Users      → proxyFetch → Xano      │  │  Urgency Classification  │  │
│  │  Settings   → proxyFetch → Xano      │  │  Data Validation         │  │
│  │  Roster Tasks (read) → proxyFetch    │  │  Pattern Recognition     │  │
│  │                                      │  │  Outcome Tracking        │  │
│  │  Pattern: schema → api → hooks       │  │                          │  │
│  └──────────────────────────────────────┘  └───────────┬──────────────┘  │
│                                                         │                │
│  ┌──────────────────────────────────────────────────────┼──────────────┐  │
│  │  Webhook Handler (POST /api/webhooks/alayacare)      │              │  │
│  │  → validates secret                                  │              │  │
│  │  → publishes to QStash (dedup + retries)             │              │  │
│  └──────────────────────────────────────────────────────┘              │  │
│                                                                        │  │
│  ┌─────────────────────────────────────────────────────────────────┐   │  │
│  │  Upstash Workflow Route (POST /api/roster/workflow)             │   │  │
│  │  export const { POST } = serve(async (context) => { ... })     │   │  │
│  │                                                                 │   │  │
│  │  Steps: score → reason → contact → wait → assign/escalate      │   │  │
│  │  Uses: scoring engine, LLM reasoning, cascade logic             │   │  │
│  │  Reads/writes: Xano (via server-side XanoClient)                │   │  │
│  └─────────────────────────────────────────────────────────────────┘   │  │
│                                                                        │  │
│  ┌─────────────────────────────────────────────────────────────────┐   │  │
│  │  SMS Response Handler (POST /api/webhooks/sms-response)         │   │  │
│  │  → context.notify() to wake waiting workflow                    │   │  │
│  └─────────────────────────────────────────────────────────────────┘   │  │
└────────────────────────────────────────────────────────────────────────┘  │
         │              │                     │                             │
         ▼              ▼                     ▼                             │
┌─────────────┐  ┌─────────────┐  ┌───────────────────────────────────┐    │
│  Xano        │  │ AWS Bedrock │  │  Upstash                         │    │
│              │  │             │  │                                   │    │
│  Tables:     │  │  Haiku 4.5  │  │  Redis ─── rate limits, cache    │    │
│  - users     │  │  (LLM)      │  │  QStash ── webhook delivery      │    │
│  - clients   │  │             │  │  Workflow ─ durable execution     │    │
│  - employees │  └─────────────┘  │                                   │    │
│  - visits    │                   └───────────────────────────────────┘    │
│  - roster_tasks                                                          │
│  - audit_log                     ┌───────────────────────────────────┐   │
│  - daily_metrics                 │  AlayaCare API                    │   │
│  - skills (ref)                  │  (external partner)               │   │
│                                  └───────────────────────────────────┘   │
│  Functions:  │                                                           │
│  - CRUD APIs │                                                           │
│  - Auth      │                                                           │
│  - Queries   │                                                           │
└──────────────┘                                                           │
```

---

## Where Each Function Lives

### Decision Framework

| Question | → Location |
|---|---|
| Is it simple CRUD (create, read, update, delete, list, filter)? | **Xano** |
| Does it require mathematical computation or algorithmic logic? | **Next.js** |
| Does it call external AI services (Bedrock)? | **Next.js** |
| Does it need to wait for external events or sleep durably? | **Upstash Workflow** |
| Does it need reliable message delivery with retries? | **Upstash QStash** |
| Does it need per-user/per-endpoint throttling? | **Upstash Redis** |
| Is it a database query with simple filters? | **Xano** |
| Is it a database query with complex aggregation? | **Xano** (custom function stack) |

### Complete Function Mapping

#### Xano: Database + CRUD + Auth + Queries

| Function | Xano Endpoint | Notes |
|---|---|---|
| **Auth** | | |
| Login | `POST /auth/login` | Email/password → token |
| Get current user | `GET /auth/me` | Token validation |
| **Users** | | |
| Get/update profile | `GET/PATCH /users/me` | Standard CRUD |
| **Clients** | | |
| List clients | `GET /clients` | Paginated, searchable |
| Get client detail | `GET /clients/{id}` | Includes care requirements |
| **Employees** | | |
| List employees | `GET /employees` | With status filter |
| Get employee + skills | `GET /employees/{id}/skills` | Join with skills table |
| List all active with skills | `GET /employees/roster` | Bulk fetch for scoring engine (cacheable) |
| **Visits** | | |
| List visits | `GET /visits` | Filtered by status, date range |
| Get visit detail | `GET /visits/{id}` | Includes service requirements |
| Get visit offers | `GET /visits/{id}/offers` | Offer history for acceptance scoring |
| **Skills** | | |
| List skills | `GET /skills` | Reference data |
| **Roster Tasks** | | |
| Create task | `POST /roster_tasks` | Called by workflow or webhook handler |
| Get task | `GET /roster_tasks/{id}` | Single task with all fields |
| List tasks | `GET /roster_tasks` | Filtered by status, paginated |
| Update task | `PATCH /roster_tasks/{id}` | Status, contacts, assigned employee, etc. **Xano function stack must enforce `WHERE status NOT IN ('cancelled','completed','escalated')` on every PATCH — returns 409 on conflict.** This prevents cancelled tasks from being revived by in-flight workflow steps. |
| List escalated tasks | `GET /roster_tasks/escalated` | Filter: status = escalated |
| Get roster summary | `GET /roster_tasks/summary` | Counts by status (Xano function stack) |
| Find active by visit | `GET /roster_tasks/by-visit/{visitId}` | Filter: non-terminal status |
| Find active by employee | `GET /roster_tasks/by-employee/{employeeId}` | JSONB contacts search |
| **Audit Log** | | |
| Append audit entry | `POST /audit_log` | Append-only insert |
| Search audit log | `GET /audit_log` | By task, action, date range |
| **Daily Metrics** | | |
| Upsert daily metrics | `POST /daily_metrics/upsert` | Xano function: upsert on (date) |
| Get analytics | `GET /daily_metrics` | Date range aggregation |

**Xano function stacks** (custom logic in Xano for queries that benefit from being close to the data):
- `GET /roster_tasks/summary` — count by status, average time-to-fill
- `PATCH /roster_tasks/{id}` — enforces `WHERE status NOT IN ('cancelled','completed','escalated')`, returns 409 on conflict
- `POST /daily_metrics/upsert` — insert or update on unique (date) constraint
- `GET /employees/roster` — join employees + skills, filter active only
- `POST /employees/upsert` — upsert employee + atomically upsert `tenant_mapping` in same transaction
- `POST /clients/upsert` — upsert client + atomically upsert `tenant_mapping` in same transaction
- `POST /visits/upsert` — upsert visit + atomically upsert `tenant_mapping` in same transaction
- `POST /audit_log` — insert with `ON CONFLICT (task_id, action, idempotency_key) DO NOTHING` for retry safety

#### Next.js: Computational Engine

All of these remain as TypeScript in the Next.js codebase. They are **pure functions** or **service modules** that operate on data fetched from Xano.

| Module | Location | What It Does |
|---|---|---|
| **Scoring Engine** | `src/services/scoring/` | |
| `compute-match.ts` | Orchestrator | Bulk fetch → hard constraints → score → rank |
| `constraints.ts` | Hard filters | Schedule conflicts, skill qualifications |
| `score-skills.ts` | Dimension 1 | Skills match (valid_matched / required_count) |
| `score-relationship.ts` | Dimension 2 | Logarithmic history + recency decay |
| `score-proximity.ts` | Dimension 3 | Haversine distance + linear decay |
| `score-workload.ts` | Dimension 4 | Gaussian distribution + overload penalty |
| `score-acceptance.ts` | Dimension 5 | Acceptance rate with exponential decay |
| `match-confidence.ts` | Confidence | Distribution-based (high/medium/low) |
| `weights.ts` | Presets | 5 weight configurations |
| **LLM Reasoning** | `src/services/reasoning/` | |
| `prompts.ts` | Prompt builder | System prompt + context formatting |
| `reasoning-service.ts` | Orchestrator | Prompt → Bedrock → parse → validate |
| `parse-response.ts` | Response parser | Zod validation + markdown fence stripping |
| **Recommendation Context** | `src/services/recommendation-context.ts` | Builds visit + client context for LLM |
| **Rostering Logic** | `src/services/rostering/` | |
| `cascade-engine.ts` | Pure functions | Contact expiry, sequential/parallel cascade, escalation checks |
| `urgency-classifier.ts` | Pure function | Planned vs urgent classification + config |
| `data-validator.ts` | Pure function | Visit/employee validation, blocker/warning detection |
| `outcome-tracker.ts` | Pure function | Structured outcome extraction from resolved tasks |
| `pattern-recognition.ts` | Analysis | Always-declines, client-churn, escalation rate detection |

**Key architectural point**: These modules currently fetch data via `alayaFetch()` (AlayaCare API client). In the new architecture, they fetch from Xano instead. The scoring engine's `computeMatch()` would call Xano's `/employees/roster` and `/visits/{id}` endpoints rather than AlayaCare directly. AlayaCare becomes a data sync source (via webhooks) rather than a real-time query target.

#### Upstash: Infrastructure

| Product | Function | What It Handles |
|---|---|---|
| **Workflow** | Roster task orchestration | Durable execution of score → reason → contact → wait → assign/escalate |
| **QStash** | Webhook processing | Reliable delivery of AlayaCare webhooks with retries, DLQ, deduplication |
| **Redis** | Rate limiting | Per-user API limits, webhook ingress throttling, Bedrock quota management |
| **Redis** | Caching | Employee roster (30s TTL), AlayaCare sync data, scoring dedup locks |

---

## Data Model (Xano Tables)

### Core Tables

These tables live in Xano and are accessed via Xano API endpoints.

#### `tenant_mapping`

Maps AlayaCare external IDs to tenant ownership. Populated during bulk import and updated on every webhook upsert. Used by webhook handlers to resolve `user_id` before any tenant-scoped Xano call.

| Column | Type | Notes |
|---|---|---|
| `id` | integer (auto) | |
| `external_type` | text | "employee", "client", "visit" |
| `external_id` | integer | AlayaCare resource ID |
| `user_id` | integer | FK to users — owning tenant |

**Constraints**: Unique on `(external_type, external_id)`. Indexed on `(external_type, external_id)` for fast lookup.

#### `roster_tasks`

| Column | Type | Notes |
|---|---|---|
| `id` | integer (auto) | Xano primary key |
| `user_id` | integer | FK to users — tenant isolation (Xano auth filter) |
| `visit_id` | integer | AlayaCare visit reference |
| `client_id` | integer | AlayaCare client reference (nullable) |
| `status` | text | Current state: idle, scoring, reasoning, contacting, accepted, assigned, escalated, completed, cancelled |
| `urgency` | text | "planned" or "urgent" |
| `match_result` | json | Scored candidates from scoring engine |
| `llm_recommendation` | json | LLM reasoning output |
| `contacts` | json | Array of ContactAttempt objects |
| `current_contact_index` | integer | Sequential cascade position |
| `cascade_strategy` | text | "sequential" or "parallel" |
| `assigned_employee_id` | integer | Accepted caregiver (nullable) |
| `escalation_reason` | text | Why escalated (nullable) |
| `workflow_run_id` | text | Upstash Workflow run ID (for correlation) |
| `detected_at` | timestamp | When vacancy detected |
| `scoring_completed_at` | timestamp | When scoring finished |
| `first_contact_at` | timestamp | When first contact sent |
| `resolved_at` | timestamp | When terminal state reached |
| `time_to_fill_ms` | integer | Duration: detected → resolved |
| `source_event_id` | text | Webhook event that triggered this task |
| `created_by` | text | "system" or user ID |
| `created_at` | timestamp | Row creation |
| `updated_at` | timestamp | Last modification |

**Note**: The `version` column from the current schema is **not needed** — Upstash Workflow's single-execution-per-run model eliminates concurrent modification. For CRUD operations outside the workflow (human actions), Xano's built-in conflict handling is sufficient.

**Constraints**: Unique partial index on `(visit_id, user_id) WHERE status NOT IN ('cancelled','completed','escalated')`. Prevents duplicate active roster tasks for the same visit. Combined with QStash deduplication (24-hour window) and the scoring lock, this provides three layers of duplicate prevention.

#### `audit_log`

| Column | Type | Notes |
|---|---|---|
| `id` | integer (auto) | |
| `user_id` | integer | FK to users — tenant isolation |
| `task_id` | integer | FK to roster_tasks |
| `timestamp` | timestamp | When action occurred |
| `action` | text | e.g., "scoring_to_reasoning", "contact_declined" |
| `actor` | text | "system", "llm", "workflow", or user ID |
| `details` | json | Action-specific metadata |
| `reasoning` | text | LLM reasoning excerpt (nullable) |
| `idempotency_key` | text | Deterministic key for dedup on retry (nullable) |

**Constraints**: Unique on `(task_id, action, idempotency_key)`. Audit log POSTs from workflow steps use `${taskId}-${action}-${stepName}` as the key. Xano upserts on conflict (ignore duplicate) so retried steps don't create duplicate entries.

#### `daily_metrics`

| Column | Type | Notes |
|---|---|---|
| `id` | integer (auto) | |
| `user_id` | integer | FK to users — tenant isolation |
| `date` | date | Unique constraint on `(user_id, date)` |
| `tasks_created` | integer | |
| `tasks_filled_autonomous` | integer | |
| `tasks_escalated` | integer | |
| `avg_time_to_fill_ms` | integer | |
| `first_contact_acceptance_rate` | float | |

### Reference Tables (Synced from AlayaCare)

These tables are populated by webhook event handlers and serve as the local data source for the scoring engine. This eliminates real-time AlayaCare API calls during scoring.

**Tenant isolation**: Every synced table includes a `user_id` column for tenant isolation. Webhook handlers and bulk imports must populate `user_id` on every upsert. All Xano function stacks for synced tables must enforce `WHERE user_id = :userId` — even for service-token requests — so that workflows cannot read cross-tenant data.

**Tenant resolution**: AlayaCare webhooks do not include a tenant identifier. To map external IDs to tenants without cross-tenant reads, webhook handlers use the `tenant_mapping` table (see Core Tables section above) to resolve `user_id` **before** any tenant-scoped Xano call. Each handler also upserts the mapping after resolution, so new resources created via webhook are discoverable by future events. The `tenant_mapping` endpoint (`GET /tenant_mapping`) is the **only** Xano endpoint exempt from the `WHERE user_id = :userId` requirement — it returns only the `user_id`, exposing no tenant data.

#### `employees` (synced)

| Column | Type | Notes |
|---|---|---|
| `id` | integer | AlayaCare employee ID |
| `user_id` | integer | FK to users — tenant isolation (required) |
| `name` | text | |
| `status` | text | active, inactive, on_leave |
| `latitude` | float | GPS coordinates (nullable) |
| `longitude` | float | |
| `weekly_hours` | float | Current scheduled hours |
| `synced_at` | timestamp | Last sync from AlayaCare |

#### `employee_skills` (synced)

| Column | Type | Notes |
|---|---|---|
| `employee_id` | integer | FK to employees |
| `user_id` | integer | FK to users — tenant isolation (required) |
| `skill_id` | integer | AlayaCare skill reference |
| `expired_date` | date | Expiry (nullable) |

#### `clients` (synced)

| Column | Type | Notes |
|---|---|---|
| `id` | integer | AlayaCare client ID |
| `user_id` | integer | FK to users — tenant isolation (required) |
| `name` | text | |
| `latitude` | float | GPS coordinates (nullable) |
| `longitude` | float | |
| `required_skills` | json | Array of skill IDs |
| `synced_at` | timestamp | Last sync from AlayaCare |

#### `visits` (synced)

| Column | Type | Notes |
|---|---|---|
| `id` | integer | AlayaCare visit ID |
| `user_id` | integer | FK to users — tenant isolation (required) |
| `client_id` | integer | FK to clients |
| `start_at` | timestamp | Shift start |
| `end_at` | timestamp | Shift end |
| `status` | text | AlayaCare visit status |
| `required_skills` | json | Skill requirements |
| `service_instructions` | text | Notes (used for urgency classification) |
| `synced_at` | timestamp | Last sync from AlayaCare |

#### `visit_offers` (synced)

| Column | Type | Notes |
|---|---|---|
| `visit_id` | integer | FK to visits |
| `employee_id` | integer | FK to employees |
| `user_id` | integer | FK to users — tenant isolation (required) |
| `status` | text | offered, accepted, declined, expired |
| `created_at` | timestamp | |

#### `employee_unavailabilities` (synced)

Records unavailability windows for employees. Used by the scoring engine's `checkScheduleConflicts()` to filter candidates who are unavailable during the visit's time range.

| Column | Type | Notes |
|---|---|---|
| `id` | integer (auto) | |
| `employee_id` | integer | FK to employees |
| `user_id` | integer | FK to users — tenant isolation (required) |
| `start_at` | timestamp | Unavailability window start |
| `end_at` | timestamp | Unavailability window end |
| `reason` | text | leave, sick, training, etc. |
| `synced_at` | timestamp | Last sync from AlayaCare |

**Note**: The `employee.unavailability` webhook handler upserts records here (not a field on `employees`). The scoring engine queries this table with `WHERE employee_id = :id AND start_at <= :visitEnd AND end_at >= :visitStart` to detect conflicts.

**Data flow**: AlayaCare webhook → QStash → Next.js handler → Xano CRUD (upsert synced tables with `user_id`). The scoring engine then reads from these local tables rather than calling AlayaCare's API in real-time. This eliminates the N+1 problem and the need for the AlayaCare TTL cache.

**Initial data population**: Webhooks handle incremental updates, but the synced tables need initial data. A one-time bulk import endpoint fetches all current data from AlayaCare and populates Xano:

```typescript
// app/api/admin/sync-alayacare/route.ts (one-time setup, admin-only)
// Fetches all employees, clients, visits, skills from AlayaCare API
// and upserts into Xano synced tables. Run once during deployment,
// then webhooks keep data current.
//
// Xano endpoints needed:
//   POST /employees/bulk-upsert  — accepts array, upserts by AlayaCare ID
//   POST /clients/bulk-upsert    — accepts array, upserts by AlayaCare ID
//   POST /visits/bulk-upsert     — accepts array, upserts by AlayaCare ID
//   POST /skills/bulk-upsert     — accepts array, upserts by AlayaCare ID
//
// IMPORTANT: Also populates tenant_mapping table for each imported record
// (external_type + external_id → user_id). This is required for webhook
// handlers to resolve tenant ownership without cross-tenant reads.
```

This endpoint should be protected by admin role check and rate-limited to prevent accidental re-runs.

### Data Sync Reliability

Webhooks are the primary sync mechanism, which introduces risks of silent data drift if events are missed, delayed, or processed out of order. The following safeguards are required:

#### Known Risks

| Risk | Scenario | Impact |
|---|---|---|
| **Missed webhooks** | AlayaCare drops an event; QStash retries exhausted | Synced table silently stale — scoring uses outdated data |
| **Out-of-order delivery** | Employee unavailable → available; webhooks arrive reversed | Local table shows wrong status until next event |
| **Initial sync gap** | Changes between bulk import and first webhook | Records missed entirely |
| **Partial sync** | Visit webhook arrives before client webhook | FK violation or missing context during scoring |
| **Silent staleness** | No webhook for days on a stable record | No way to distinguish "unchanged" from "missed update" |

#### Required Mitigations

**1. Periodic Reconciliation Job** (critical)

A scheduled job via Upstash QStash cron that diffs local tables against AlayaCare's API and patches gaps. Webhooks handle the happy path (low latency); reconciliation catches anything that slips through.

Tables are staggered to respect AlayaCare rate limits (shared budget with real-time webhook processing and scoring):

| Schedule | Table | Rationale |
|---|---|---|
| `:00, :15, :30, :45` | `employees` + `employee_skills` | Most critical for scoring accuracy |
| `:05, :20, :35, :50` | `clients` | Required skills + GPS coordinates |
| `:10, :25, :40, :55` | `visits` + `visit_offers` | Highest volume, least latency-sensitive |

Each reconciliation run is rate-limited via `alayacareLimiter` (see Rate Limiting section) to prevent starving real-time operations.

```typescript
// app/api/cron/reconcile-alayacare/route.ts
// Triggered by QStash cron schedule (staggered per table — see table above)
//
// Distributed lock: Acquire a Redis lock at the start of each run to prevent
// overlapping reconciliation jobs from racing. If the lock is held, skip the run.
//   const lockKey = `lock:reconcile:${tableName}`;
//   const acquired = await redis.set(lockKey, "1", { ex: 300, nx: true });
//   if (!acquired) return Response.json({ skipped: "lock held" });
//   try { ... } finally { await redis.del(lockKey); }
//
// Two-phase approach:
//   Phase 1 (cheap): Count check — compare local record count vs AlayaCare
//     If counts match, skip full diff (fast path)
//   Phase 2 (expensive): Full diff — only runs if counts diverge or on
//     every 4th run (hourly) as a safety net
//
// For full diff:
//   1. Fetch current records from AlayaCare API (paginated, rate-limited)
//   2. Compare against local Xano table by ID + synced_at
//   3. Upsert any records where AlayaCare is newer (shared upsert function)
//   4. Log discrepancies for observability (count, stale IDs, drift duration)
//
// Xano endpoints needed:
//   GET  /employees/count                    — fast count for phase 1
//   GET  /employees/stale?since={timestamp}  — local records older than threshold
//   POST /employees/bulk-upsert              — shared with webhook handlers (see mitigation 3)
```

**2. Staleness Detection at Scoring Time**

Before scoring, check `synced_at` on critical records. If any employee or visit record hasn't been synced within a threshold (e.g. 30 minutes), log a warning and optionally trigger an on-demand refresh.

**3. Last-Write-Wins with Timestamps**

All upserts must compare `synced_at` — only overwrite if the incoming data is newer. This prevents out-of-order webhooks from reverting to stale state.

The `synced_at` value should use AlayaCare's `updated_at` field where available (server-authoritative), falling back to webhook receive time (our clock) when the API doesn't provide it. Both webhook handlers and the reconciliation job **must use the same Xano upsert function stack** to ensure consistent conflict resolution.

```typescript
// Xano function stack: upsert_employee (shared by webhook handlers + reconciliation)
// WHERE id = input.id AND (synced_at IS NULL OR synced_at < input.synced_at)
//
// synced_at source priority:
//   1. AlayaCare updated_at field (if present in payload/API response)
//   2. Webhook receive timestamp (fallback)
```

**4. Dead Letter Queue + Alerting**

When QStash exhausts retries on a webhook, route to a dead letter queue (Upstash Redis list). Alert on DLQ depth > 0 so ops can investigate and manually replay.

**5. Referential Ordering**

Process webhooks in dependency order: employees and clients before visits, visits before offers. The QStash event handler should check for FK existence and re-queue with exponential backoff (1s, 5s, 30s) if the parent record doesn't exist yet. Max 5 retries — after exhaustion, route to the DLQ (mitigation 4) with the missing FK reference logged for investigation.

#### Design Decision

The synced-table approach trades a known problem (N+1 API latency, rate limit pressure) for a subtler one (silent data staleness). The current PoC TTL cache is less elegant but has a useful property: it always goes back to the source of truth within 30 seconds. The mitigations above are **not optional** — without reconciliation, the architecture is fragile in production.

---

## CRUD Layer — Template Pattern

Standard data access follows the **mayfly-template-nextjs three-file domain pattern**. The browser calls `proxyFetch()` → `POST /api/proxy` → Xano, with auth token injected server-side from the HMAC-signed httpOnly cookie.

### Example: Roster Tasks Domain

**File 1: Schema** — `src/lib/schemas/roster-task.ts`

```typescript
import { z } from "zod";

// ── Response schemas (validate Xano responses) ──────────────

const contactAttemptSchema = z.object({
  employee_id: z.number(),
  employee_name: z.string(),
  contact_address: z.string(),
  rank: z.number(),
  overall_score: z.number(),
  channel: z.enum(["sms", "email"]),
  sent_at: z.string(),
  expires_at: z.string(),
  response: z.enum(["pending", "accepted", "declined", "expired"]),
  responded_at: z.string().nullable(),
  decline_reason: z.string().nullable(),
  selection_reason: z.string(),
});

export const rosterTaskSchema = z.object({
  id: z.number(),
  visit_id: z.number(),
  client_id: z.number().nullable(),
  status: z.enum([
    "idle", "scoring", "reasoning", "contacting",
    "accepted", "assigned", "escalated", "completed", "cancelled",
  ]),
  urgency: z.enum(["planned", "urgent"]),
  match_result: z.unknown().nullable(),
  llm_recommendation: z.unknown().nullable(),
  contacts: z.array(contactAttemptSchema),
  current_contact_index: z.number(),
  assigned_employee_id: z.number().nullable(),
  escalation_reason: z.string().nullable(),
  workflow_run_id: z.string().nullable(),
  detected_at: z.string(),
  resolved_at: z.string().nullable(),
  time_to_fill_ms: z.number().nullable(),
  created_at: z.number(),
  updated_at: z.number(),
});

export const rosterTaskListSchema = z.array(rosterTaskSchema);

export const rosterSummarySchema = z.object({
  total: z.number(),
  by_status: z.record(z.string(), z.number()),
  avg_time_to_fill_ms: z.number().nullable(),
});

// ── Request schemas (validate user input) ───────────────────

export const createRosterTaskInputSchema = z.object({
  visit_id: z.number().int().positive(),
  client_id: z.number().int().positive().optional(),
  urgency: z.enum(["planned", "urgent"]).optional(),
});

export const humanActionInputSchema = z.object({
  action: z.enum(["accept_recommendation", "assign_manually", "defer", "take_over", "cancel"]),
  employee_id: z.number().optional(),
  reason: z.string().optional(),
});

// ── Types ───────────────────────────────────────────────────

export type RosterTask = z.infer<typeof rosterTaskSchema>;
export type RosterSummary = z.infer<typeof rosterSummarySchema>;
export type CreateRosterTaskInput = z.infer<typeof createRosterTaskInputSchema>;
export type HumanActionInput = z.infer<typeof humanActionInputSchema>;
```

**File 2: API Functions** — `src/lib/api/roster-tasks.ts`

```typescript
import { proxyFetch } from "./proxy-fetch";
import {
  rosterTaskSchema,
  rosterTaskListSchema,
  rosterSummarySchema,
  type CreateRosterTaskInput,
  type HumanActionInput,
  type RosterTask,
  type RosterSummary,
} from "@/src/lib/schemas/roster-task";

const API_GROUP = "roster";

export async function getRosterTasks(
  status?: string,
  page = 1,
  perPage = 50
): Promise<RosterTask[]> {
  const raw = await proxyFetch({
    apiGroup: API_GROUP,
    endpoint: "/roster_tasks",
    params: { status, page, per_page: perPage },
  });
  return rosterTaskListSchema.parse(raw);
}

export async function getRosterTask(id: number): Promise<RosterTask> {
  const raw = await proxyFetch({
    apiGroup: API_GROUP,
    endpoint: `/roster_tasks/${id}`,
  });
  return rosterTaskSchema.parse(raw);
}

export async function getEscalatedTasks(): Promise<RosterTask[]> {
  const raw = await proxyFetch({
    apiGroup: API_GROUP,
    endpoint: "/roster_tasks/escalated",
  });
  return rosterTaskListSchema.parse(raw);
}

export async function getRosterSummary(): Promise<RosterSummary> {
  const raw = await proxyFetch({
    apiGroup: API_GROUP,
    endpoint: "/roster_tasks/summary",
  });
  return rosterSummarySchema.parse(raw);
}

export async function createRosterTask(input: CreateRosterTaskInput): Promise<RosterTask> {
  const raw = await proxyFetch({
    apiGroup: API_GROUP,
    endpoint: "/roster_tasks",
    method: "POST",
    params: input,
  });
  return rosterTaskSchema.parse(raw);
}

export async function performHumanAction(
  taskId: number,
  input: HumanActionInput
): Promise<RosterTask> {
  const raw = await proxyFetch({
    apiGroup: API_GROUP,
    endpoint: `/roster_tasks/${taskId}/action`,
    method: "POST",
    params: input,
  });
  return rosterTaskSchema.parse(raw);
}
```

**File 3: TanStack Query Hooks** — `src/hooks/useRosterTasks.ts`

```typescript
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getRosterTasks,
  getRosterTask,
  getEscalatedTasks,
  getRosterSummary,
  createRosterTask,
  performHumanAction,
} from "@/src/lib/api/roster-tasks";
import type { CreateRosterTaskInput, HumanActionInput } from "@/src/lib/schemas/roster-task";

export const rosterTaskKeys = {
  all: ["roster-tasks"] as const,
  list: (status?: string) => ["roster-tasks", "list", status] as const,
  detail: (id: number) => ["roster-tasks", id] as const,
  escalated: ["roster-tasks", "escalated"] as const,
  summary: ["roster-tasks", "summary"] as const,
};

export function useRosterTasks(status?: string) {
  return useQuery({
    queryKey: rosterTaskKeys.list(status),
    queryFn: () => getRosterTasks(status),
  });
}

export function useRosterTask(id: number) {
  return useQuery({
    queryKey: rosterTaskKeys.detail(id),
    queryFn: () => getRosterTask(id),
    enabled: id > 0,
  });
}

export function useEscalatedTasks() {
  return useQuery({
    queryKey: rosterTaskKeys.escalated,
    queryFn: getEscalatedTasks,
  });
}

export function useRosterSummary() {
  return useQuery({
    queryKey: rosterTaskKeys.summary,
    queryFn: getRosterSummary,
  });
}

export function useCreateRosterTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateRosterTaskInput) => createRosterTask(input),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: rosterTaskKeys.all });
    },
  });
}

export function useHumanAction(taskId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: HumanActionInput) => performHumanAction(taskId, input),
    // Optimistic update: immediately reflect the action in the UI
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: rosterTaskKeys.detail(taskId) });
      const previous = qc.getQueryData<RosterTask>(rosterTaskKeys.detail(taskId));
      if (previous) {
        const optimistic = { ...previous };
        if (input.action === "cancel") optimistic.status = "cancelled";
        if (input.action === "accept_recommendation") optimistic.status = "assigned";
        if (input.action === "assign_manually") {
          optimistic.status = "assigned";
          optimistic.assigned_employee_id = input.employee_id ?? null;
        }
        qc.setQueryData(rosterTaskKeys.detail(taskId), optimistic);
      }
      return { previous };
    },
    onError: (_err, _input, context) => {
      if (context?.previous) {
        qc.setQueryData(rosterTaskKeys.detail(taskId), context.previous);
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: rosterTaskKeys.detail(taskId) });
      qc.invalidateQueries({ queryKey: rosterTaskKeys.all });
    },
  });
}
```

This pattern is repeated for all standard domains: **clients**, **employees**, **visits**, **skills**, **audit log**, **daily metrics**.

---

## Workflow Layer — Upstash Workflow

### Roster Task Workflow

The workflow replaces the current `workflow-orchestrator.ts`. Each step is a durable `context.run()` call. The workflow sleeps between contact attempts using `context.waitForEvent()`, which suspends execution at zero cost until a caregiver responds or the timeout expires.

#### Simplified State Flow

The current 11-state machine is reduced to a linear workflow with branching:

```
idle → score → reason → [contact → wait → response]* → assign/escalate
                ↓                        ↓
            escalate               escalate (timeout/exhausted)
```

States `detected`, `gathering`, and `cascading` are eliminated (no-op transitions in the current system). The `contacting` → `cascading` loop becomes a `for` loop within the workflow.

#### Workflow Implementation

```typescript
// app/api/roster/workflow/route.ts

import { serve } from "@upstash/workflow/nextjs";
import { Client } from "@upstash/workflow";
import { computeMatch } from "@/src/services/scoring";
import { getRecommendation } from "@/src/services/reasoning/reasoning-service";
import { buildRecommendationContext } from "@/src/services/recommendation-context";
import { getUrgencyConfig } from "@/src/services/rostering/urgency-classifier";
import { createXanoClient } from "@/src/lib/xano/client";
import { XANO_SERVICE_TOKEN } from "@/src/lib/xano/config";
import { alayaFetch } from "@/src/lib/alayacare-client";
import { getCachedEmployeeRoster, acquireScoringLock } from "@/src/lib/cache";

const MIN_VIABLE_CANDIDATES = 3;

export const { POST } = serve(
  async (context) => {
    const { taskId, visitId, urgency, detectedAt, userId } = context.requestPayload as {
      taskId: number;
      visitId: number;
      urgency: "planned" | "urgent";
      detectedAt: string; // ISO timestamp from task creation
      userId: number;     // Tenant ID (FK to users) — required for data isolation
    };

    if (!userId) throw new Error("Workflow triggered without userId — tenant isolation breach");

    const config = getUrgencyConfig(urgency);
    // XanoClient is stateless — intentionally created fresh per invocation.
    // Upstash Workflow re-executes this function on each step resumption
    // (each step = separate HTTP request), so no state carries between steps.
    // userId is passed so all Xano endpoints filter by tenant.
    // Timeout set to 8s — under the Vercel serverless limit (10-15s) so
    // Upstash Workflow can detect the timeout and retry, rather than the
    // entire serverless function timing out with no retry.
    const xano = createXanoClient("roster", XANO_SERVICE_TOKEN, {
      userId,
      timeoutMs: 8_000,
    });

    // Helper: update task status in Xano + append audit log.
    // Short-circuits if the task is already in a terminal state (cancelled,
    // completed, escalated) to prevent a running workflow from overwriting
    // a manual cancellation or prior resolution.
    //
    // Note: This GET-then-PATCH has a TOCTOU race with the cancel handler
    // (which runs outside the workflow). The Xano PATCH endpoint must also
    // enforce WHERE status NOT IN ('cancelled','completed','escalated') as
    // a second layer of protection — returning a no-op if the row was
    // already resolved between this read and write.
    const TERMINAL_STATUSES = ["cancelled", "completed", "escalated"];
    async function updateStatus(status: string, extra?: Record<string, unknown>) {
      const current = await xano.get(`/roster_tasks/${taskId}`);
      if (TERMINAL_STATUSES.includes(current.status)) {
        return; // Task already resolved — do not overwrite
      }
      await xano.patch(`/roster_tasks/${taskId}`, { status, ...extra });
      await xano.post("/audit_log", {
        task_id: taskId,
        action: `status_${status}`,
        actor: "workflow",
        details: extra ?? {},
        idempotency_key: `${taskId}-status_${status}-${context.workflowRunId}`,
      });
    }

    // ── Step 0: Acquire scoring lock ──────────────────────────────
    // Prevents duplicate workflows for the same visit (e.g. QStash retry +
    // original both succeed, or genuine duplicate webhooks). If another
    // workflow already holds the lock, exit early — it's handling this visit.
    const lockAcquired = await context.run("acquire-scoring-lock", () =>
      acquireScoringLock(visitId)
    );
    if (!lockAcquired) {
      return { status: "deduplicated" };
    }

    // ── Step 1: Score Candidates ────────────────────────────────
    await context.run("update-status-scoring", () => updateStatus("scoring"));

    // Score candidates. Store full result in Xano (controlled region),
    // return only metadata to Upstash workflow journal (avoids PII in journal).
    const scoringMeta = await context.run("score", async () => {
      // Use Redis-cached roster to avoid hammering Xano during bursts.
      // getCachedEmployeeRoster() has stampede prevention — concurrent
      // workflows share a single in-flight fetch.
      const [employees, visit] = await Promise.all([
        getCachedEmployeeRoster(xano, String(userId)),
        xano.get(`/visits/${visitId}`),
      ]);
      const result = computeMatch(visit, employees, { preset: config.weightPreset });
      await xano.patch(`/roster_tasks/${taskId}`, {
        match_result: result,
        scoring_completed_at: new Date().toISOString(),
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

    // Read full match result from Xano for subsequent steps (LLM reasoning, cascade)
    const taskWithScores = await context.run("load-scores", () =>
      xano.get(`/roster_tasks/${taskId}`)
    );
    const matchResult = taskWithScores.match_result;
    const candidates = matchResult.candidates ?? [];

    // ── Step 2: LLM Reasoning ──────────────────────────────────
    await context.run("update-status-reasoning", () =>
      updateStatus("reasoning", { match_result: matchResult })
    );

    let recommendation = null;
    try {
      recommendation = await context.run("reason", async () => {
        const ctx = await buildRecommendationContext(visitId, matchResult, urgency);
        return getRecommendation({
          visit: ctx.visit,
          client: ctx.client,
          matchResult,
          context: ctx.context,
        });
      });
    } catch {
      // LLM failure — proceed with scoring-only (fallback)
      await context.run("audit-llm-fallback", () =>
        xano.post("/audit_log", {
          task_id: taskId,
          action: "llm_fallback",
          actor: "workflow",
          details: { reason: "LLM service unavailable" },
          idempotency_key: `${taskId}-llm_fallback-${context.workflowRunId}`,
        })
      );
    }

    // Check escalation recommendation
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

    if (recommendation?.primary?.confidence === "low") {
      await context.run("escalate-low-confidence", () =>
        updateStatus("escalated", {
          llm_recommendation: recommendation,
          escalation_reason: "LLM confidence low — needs human review",
        })
      );
      return { status: "escalated" };
    }

    // ── Step 3: Contact Cascade ────────────────────────────────
    await context.run("update-status-contacting", () =>
      updateStatus("contacting", { llm_recommendation: recommendation })
    );

    const maxContacts = Math.min(
      candidates.length,
      config.escalationThreshold.type === "contacts"
        ? config.escalationThreshold.count
        : candidates.length
    );

    for (let i = 0; i < maxContacts; i++) {
      const candidate = candidates[i];

      // Send contact (SMS/email)
      await context.run(`send-contact-${i}`, async () => {
        const now = new Date().toISOString();
        const expiresAt = new Date(Date.now() + config.expiryMinutes * 60_000).toISOString();

        // Build contact attempt record
        const contact = {
          employee_id: candidate.employee_id,
          employee_name: candidate.employee_name,
          contact_address: "", // populated by SMS/email provider
          rank: i + 1,
          overall_score: candidate.overall,
          channel: "sms" as const,
          sent_at: now,
          expires_at: expiresAt,
          response: "pending" as const,
          responded_at: null,
          decline_reason: null,
          selection_reason: `Rank #${i + 1} by scoring engine`,
        };

        // Read current contacts from task — exit early if task was cancelled
        const currentTask = await xano.get(`/roster_tasks/${taskId}`);
        if (TERMINAL_STATUSES.includes(currentTask.status)) {
          return; // Task cancelled/completed — abort contact
        }

        // Deduplicate: skip if this employee was already contacted (step retry)
        const alreadyContacted = (currentTask.contacts ?? []).some(
          (c: { employee_id: number }) => c.employee_id === candidate.employee_id
        );
        if (alreadyContacted) return;

        const contacts = [...(currentTask.contacts ?? []), contact];

        // TODO: Replace with real SMS/email provider call
        // Use provider idempotency key: `roster-${taskId}-contact-${candidate.employee_id}`
        // await smsProvider.send(candidate.phone, taskId, candidate.employee_id, {
        //   idempotencyKey: `roster-${taskId}-contact-${candidate.employee_id}`,
        // });

        // PATCH uses Xano function stack with WHERE status NOT IN terminal guard.
        // Returns 409 if task was cancelled between our GET and this PATCH.
        await xano.patch(`/roster_tasks/${taskId}`, {
          current_contact_index: i,
          contacts,
          first_contact_at: i === 0 ? now : currentTask.first_contact_at,
        });
        await xano.post("/audit_log", {
          task_id: taskId,
          action: "contact_sent",
          actor: "workflow",
          details: {
            employee_id: candidate.employee_id,
            employee_name: candidate.employee_name,
            rank: i + 1,
            channel: "sms",
          },
          idempotency_key: `${taskId}-contact_sent-send-contact-${i}`,
        });
      });

      // Wait for caregiver response or timeout
      const { eventData, timeout } = await context.waitForEvent(
        `wait-response-${i}`,
        `caregiver-${taskId}-${candidate.employee_id}`,
        { timeout: `${config.expiryMinutes}m` }
      );

      if (!timeout && eventData?.accepted) {
        // ── Accepted: Write back to AlayaCare ──────────────────
        await context.run("mark-accepted", () =>
          updateStatus("accepted", { assigned_employee_id: candidate.employee_id })
        );

        // Use context.run() (NOT context.call()) — keeps AlayaCare credentials
        // server-side. context.call() would send credentials to Upstash's infrastructure.
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

        // Write-back failure → escalate for human intervention (never mark "assigned"
        // without AlayaCare confirmation — the visit would appear covered but isn't)
        if (!writeBackResult.success) {
          await context.run("escalate-writeback-failed", () =>
            updateStatus("escalated", {
              escalation_reason: `AlayaCare write-back failed: ${writeBackResult.error}`,
              llm_recommendation: { assigned_employee_id: candidate.employee_id },
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

      // Declined or timeout — update contact response + audit
      await context.run(`update-result-${i}`, async () => {
        const task = await xano.get(`/roster_tasks/${taskId}`);
        if (TERMINAL_STATUSES.includes(task.status)) return; // cancelled — skip

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
          details: {
            employee_id: candidate.employee_id,
            decline_reason: eventData?.declineReason ?? null,
          },
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
  {
    // Flow control: prevent overwhelming Xano/AlayaCare during bursts
    retries: 3,
  }
);
```

#### Parallel Cascade (Urgent Shifts)

For urgent shifts, the workflow contacts multiple candidates simultaneously. The first acceptance wins; remaining contacts are cancelled.

**Known limitation — sequential wait polling**: The wait loop below iterates sequentially through `waitForEvent` calls. If caregiver #5 accepts while the loop is still blocked on caregiver #1's timeout, the acceptance is not processed until #1 expires. Upstash Workflow's step model does not natively support `Promise.any`/`Promise.race` across `waitForEvent` calls — each `waitForEvent` is a durable step that suspends and resumes the function, so they cannot be composed with JavaScript promise combinators.

**Worst-case delay**: For a batch of 5 candidates with a 5-minute expiry, the maximum delay before an acceptance is processed is `(index - 1) × expiryMinutes`. If caregiver #5 accepts instantly but #1–#4 are silent, the acceptance is not acted on for ~20 minutes. This is acceptable only if urgent expiry windows are kept short (5 minutes recommended, producing a 20-minute worst case).

**Mitigations**:
1. Keep `expiryMinutes` short for urgent shifts (5 minutes) to bound the worst-case delay
2. `waitForEvent` returns immediately if the event has already arrived, so earlier acceptances resolve without delay — only later-indexed acceptances suffer
3. When Upstash adds a `waitForAnyEvent` primitive, refactor to use it — track this via [Upstash Workflow feature requests](https://github.com/upstash/workflow-js/issues)
4. As an interim alternative, consider splitting urgent cascades into separate single-candidate workflows that race independently (each workflow creates an offer, waits for response, and notifies a coordinator workflow), trading complexity for true parallelism

The `parallelCascade` function is defined **inside** the `serve()` callback (like `updateStatus`) so it has closure access to `context`, `taskId`, `xano`, `updateStatus`, and `detectedAt`. Add this function and the branch inside the workflow, after the LLM reasoning block and before the sequential contact loop:

```typescript
    // ── Inside serve() callback, before Step 3 ─────────────────

    // Parallel cascade — sends contacts to multiple candidates simultaneously,
    // then polls responses sequentially. First acceptance in iteration order
    // resolves the task. See "Known limitation" above for worst-case delay
    // when a later-indexed candidate accepts before an earlier one times out.
    async function parallelCascade() {
      const batchSize = Math.min(candidates.length, 5);
      const batch = candidates.slice(0, batchSize);

      // Capture timestamp inside a step — Date.now() outside context.run()
      // produces different values on workflow re-execution (step resumption).
      const now = await context.run("capture-parallel-time", () =>
        new Date().toISOString()
      );

      // Build contact objects and persist them on the task (mirrors sequential path)
      const contactObjects = batch.map((candidate, i) => ({
        employee_id: candidate.employee_id,
        employee_name: candidate.employee_name,
        contact_address: candidate.phone ?? candidate.email ?? "",
        rank: i + 1,
        overall_score: candidate.overall,
        channel: "sms" as const,
        sent_at: now,
        expires_at: new Date(Date.now() + config.expiryMinutes * 60_000).toISOString(),
        response: "pending" as const,
        responded_at: null,
        decline_reason: null,
        selection_reason: `Parallel batch — rank #${i + 1}`,
      }));

      // Send all contacts in parallel + record on task
      await Promise.all(
        batch.map((candidate, i) =>
          context.run(`send-parallel-${i}`, async () => {
            // TODO: Send SMS/email to candidate
            await xano.post("/audit_log", {
              task_id: taskId,
              action: "contact_sent_parallel",
              actor: "workflow",
              details: { employee_id: candidate.employee_id, rank: i + 1, batch_size: batchSize },
              idempotency_key: `${taskId}-contact_sent_parallel-send-parallel-${i}`,
            });
          })
        )
      );

      // Persist all contacts on the task (audit trail + UI visibility)
      await context.run("record-parallel-contacts", async () => {
        const currentTask = await xano.get(`/roster_tasks/${taskId}`);
        if (TERMINAL_STATUSES.includes(currentTask.status)) return;
        await xano.patch(`/roster_tasks/${taskId}`, {
          contacts: [...(currentTask.contacts ?? []), ...contactObjects],
          current_contact_index: batchSize - 1,
          first_contact_at: currentTask.first_contact_at ?? now,
        });
      });

      // Poll each wait sequentially — first acceptance exits immediately.
      // Upstash waitForEvent returns immediately if the event already arrived,
      // so earlier acceptances don't block on later timeouts.
      let acceptedCandidate: typeof batch[number] | null = null;
      for (let i = 0; i < batch.length; i++) {
        const { eventData, timeout } = await context.waitForEvent(
          `wait-parallel-${i}`,
          `caregiver-${taskId}-${batch[i].employee_id}`,
          { timeout: `${config.expiryMinutes}m` }
        );

        // Update the contact's response in the stored array
        await context.run(`update-contact-${i}`, async () => {
          const task = await xano.get(`/roster_tasks/${taskId}`);
          const contacts = [...(task.contacts ?? [])];
          const idx = contacts.findIndex(
            (c: { employee_id: number }) => c.employee_id === batch[i].employee_id
          );
          if (idx >= 0) {
            contacts[idx] = {
              ...contacts[idx],
              response: timeout ? "expired" : eventData?.accepted ? "accepted" : "declined",
              responded_at: timeout ? null : new Date().toISOString(),
              decline_reason: eventData?.declineReason ?? null,
            };
            await xano.patch(`/roster_tasks/${taskId}`, { contacts });
          }
        });

        if (!timeout && eventData?.accepted) {
          acceptedCandidate = batch[i];
          break; // First acceptance — stop waiting for remaining candidates
        }
      }

      if (acceptedCandidate) {
        await context.run("mark-accepted", () =>
          updateStatus("accepted", { assigned_employee_id: acceptedCandidate!.employee_id })
        );

        const writeBackResult = await context.run("alayacare-writeback", async () => {
          try {
            await alayaFetch(`/scheduler/visits/${visitId}/offers`, {
              method: "POST",
              body: { employee_id: acceptedCandidate!.employee_id },
              headers: {
                "Idempotency-Key": `roster-${taskId}-offer-${acceptedCandidate!.employee_id}`,
              },
            });
            return { success: true };
          } catch (err) {
            return { success: false, error: String(err) };
          }
        });

        // Write-back failure → escalate for human intervention (never mark "assigned"
        // without AlayaCare confirmation — the visit would appear covered but isn't)
        if (!writeBackResult.success) {
          await context.run("escalate-writeback-failed", () =>
            updateStatus("escalated", {
              escalation_reason: `AlayaCare write-back failed: ${writeBackResult.error}`,
              llm_recommendation: { assigned_employee_id: acceptedCandidate!.employee_id },
            })
          );
          return { status: "escalated", reason: "writeback_failed" };
        }

        await context.run("finalize", () =>
          updateStatus("completed", {
            assigned_employee_id: acceptedCandidate!.employee_id,
            resolved_at: new Date().toISOString(),
            time_to_fill_ms: Date.now() - new Date(detectedAt).getTime(),
          })
        );
        return { status: "completed", assignedTo: acceptedCandidate.employee_id };
      }

      // No acceptances — escalate
      await context.run("escalate-parallel-exhausted", () =>
        updateStatus("escalated", {
          escalation_reason: "All parallel contacts exhausted",
          resolved_at: new Date().toISOString(),
        })
      );
      return { status: "escalated" };
    }

    // ── Step 3: Contact Cascade — branch by strategy ────────────
    if (config.cascadeStrategy === "parallel") {
      return parallelCascade();
    }
    // Otherwise fall through to sequential for-loop below
```

#### Triggering the Workflow

From the webhook handler or manual creation:

```typescript
import { Client } from "@upstash/workflow";

const workflowClient = new Client({ token: process.env.QSTASH_TOKEN! });

// After creating the roster task in Xano:
const { workflowRunId } = await workflowClient.trigger({
  url: `${process.env.APP_URL}/api/roster/workflow`,
  body: { taskId, visitId, urgency, userId, detectedAt: new Date().toISOString() },
});

// Persist run ID so cancel paths can stop the workflow
await xano.patch(`/roster_tasks/${taskId}`, { workflow_run_id: workflowRunId });
```

#### Receiving Caregiver Responses

```typescript
// app/api/webhooks/sms-response/route.ts
import { Client } from "@upstash/workflow";

const client = new Client({ token: process.env.QSTASH_TOKEN! });

export async function POST(req: Request) {
  // Verify SMS provider signature (e.g., Twilio request validation)
  // This prevents forged acceptance responses from assigning shifts.
  const signature = req.headers.get("x-twilio-signature");
  if (!signature || !verifyTwilioSignature(signature, req.url, await req.clone().text())) {
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }

  const { taskId, employeeId, accepted, declineReason } = await req.json();

  await client.notify({
    eventId: `caregiver-${taskId}-${employeeId}`,
    eventData: { accepted, declineReason },
  });

  return Response.json({ ok: true });
}

// Provider-specific signature verification.
//
// SECURITY: This function is a stub. It is NOT suitable for production use.
//   - In production (NODE_ENV=production): throws immediately, blocking all
//     caregiver responses. This is fail-closed by design — no forged responses
//     can be processed, but legitimate ones are also blocked.
//   - In non-production: skips verification entirely for local workflow testing.
//
// BEFORE PRODUCTION DEPLOYMENT, you must:
//   1. Implement real signature verification (e.g., twilio.validateRequest())
//   2. Replace this stub with the real implementation
//   3. Until then, protect the endpoint via one of:
//      a. Vercel/CDN IP allowlist (only SMS provider callback IPs)
//      b. Route-level feature flag (disable the entire SMS response flow)
//      c. Move to an internal-only network path (not exposed to public internet)
//
// This is a production blocker — tracked as a prerequisite in the production
// readiness checklist (docs/plans/production-readiness-checklist.md).
function verifyTwilioSignature(signature: string, url: string, body: string): boolean {
  if (process.env.NODE_ENV === "production") {
    // TODO: Implement with twilio.validateRequest() when SMS provider is selected
    // See: https://www.twilio.com/docs/usage/security#validating-requests
    throw new Error(
      "SMS provider signature verification not yet implemented — " +
      "this route must not be deployed to production until it is"
    );
  }
  // Development/staging only: skip verification, log warning
  console.warn("[sms-response] SMS signature verification skipped — non-production environment");
  return true;
}
```

---

## Webhook Processing — QStash

AlayaCare webhooks are received by a Next.js route, validated, and published to QStash for reliable processing. QStash provides retries, DLQ, and deduplication — replacing the current hand-rolled `WebhookDebouncer` and two-layer idempotency check.

### Webhook Route

```typescript
// app/api/webhooks/alayacare/route.ts
import { Client } from "@upstash/qstash";

const qstash = new Client({ token: process.env.QSTASH_TOKEN! });

export async function POST(req: Request) {
  // M2M auth — shared secret with timing-safe comparison (prevents timing attacks)
  const secret = req.headers.get("x-webhook-secret");
  const expected = process.env.ALAYACARE_WEBHOOK_SECRET;
  if (
    !secret ||
    !expected ||
    secret.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(secret), Buffer.from(expected))
  ) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const event = await req.json();

  // Publish to QStash — handles retries, DLQ, deduplication
  await qstash.publishJSON({
    url: `${process.env.APP_URL}/api/webhooks/process-event`,
    body: event,
    deduplicationId: event.event_id,  // QStash dedup window: 24 hours (as of 2025)
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

// Resolve tenant from the tenant_mapping table (see Data Model section).
// Uses external AlayaCare ID → user_id mapping. Does NOT read tenant-owned
// data, so it doesn't require a user_id context to query.
//
// When userId is provided in the event payload (skipping the lookup),
// callers must still call ensureTenantMapping() to keep the mapping current.
async function resolveTenant(
  xano: ReturnType<typeof createXanoClient>,
  externalType: string,
  externalId: number
): Promise<number> {
  const mapping = await xano.get("/tenant_mapping", {
    external_type: externalType,
    external_id: externalId,
  });
  if (mapping?.user_id) {
    return mapping.user_id as number;
  }

  // Fallback for single-tenant deployments: use DEFAULT_TENANT_ID env var.
  // This handles new resources created in AlayaCare after the initial bulk
  // import — they have no tenant_mapping entry yet. The handler's subsequent
  // ensureTenantMapping() call will populate the mapping for future events.
  //
  // For multi-tenant deployments, use per-tenant webhook endpoints instead:
  //   /api/webhooks/alayacare/{tenantId} — tenantId in the URL path
  //   eliminates the lookup entirely.
  const defaultTenant = process.env.DEFAULT_TENANT_ID;
  if (defaultTenant) {
    return parseInt(defaultTenant, 10);
  }

  throw new Error(
    `Cannot resolve tenant for ${externalType} ${externalId} — ` +
    `no tenant_mapping entry and no DEFAULT_TENANT_ID fallback. ` +
    `Was the bulk import run for this tenant?`
  );
}

// Upsert tenant_mapping so future webhooks for this resource can resolve
// the tenant. Called after every successful upsert to a synced table.
// Idempotent — unique constraint on (external_type, external_id).
//
// IMPORTANT: For synced-table upserts (employees, clients, visits), the
// Xano function stack should atomically maintain tenant_mapping as a side
// effect of the upsert (single function stack, single transaction). This
// prevents the failure mode where the upsert succeeds but the mapping
// call fails, leaving a synced record without a tenant mapping.
//
// The separate ensureTenantMapping() call below is kept as a safety net
// for handlers that don't go through a synced-table upsert (e.g. visit.cancelled).
async function ensureTenantMapping(
  xano: ReturnType<typeof createXanoClient>,
  externalType: string,
  externalId: number,
  userId: number
): Promise<void> {
  await xano.post("/tenant_mapping/upsert", {
    external_type: externalType,
    external_id: externalId,
    user_id: userId,
  });
}

async function handler(req: Request) {
  const event = await req.json();
  const xano = createXanoClient("roster", process.env.XANO_SERVICE_TOKEN!);

  switch (event.type) {
    case "visit.vacated": {
      // Resolve tenant FIRST — required before any tenant-scoped Xano call.
      // AlayaCare webhooks don't include user_id, so we look up the mapping.
      const userId = event.payload.user_id
        ?? await resolveTenant(xano, "visit", event.payload.visit_id);

      // Sync visit data to Xano (user_id injected so upsert passes validation)
      await xano.post("/visits/upsert", { ...event.payload, user_id: userId });
      await ensureTenantMapping(xano, "visit", event.payload.visit_id, userId);
      const task = await xano.post("/roster_tasks", {
        user_id: userId,
        visit_id: event.payload.visit_id,
        client_id: event.payload.client_id,
        urgency: classifyUrgency(event.payload),
        status: "idle",
        source_event_id: event.event_id,
      });

      // Trigger Upstash Workflow and persist run ID for cancellation.
      // userId is propagated so the workflow filters all Xano queries by tenant.
      const workflowClient = new Client({ token: process.env.QSTASH_TOKEN! });
      const { workflowRunId } = await workflowClient.trigger({
        url: `${process.env.APP_URL}/api/roster/workflow`,
        body: {
          taskId: task.id,
          visitId: event.payload.visit_id,
          urgency: classifyUrgency(event.payload),
          userId,
          detectedAt: new Date().toISOString(),
        },
      });
      await xano.patch(`/roster_tasks/${task.id}`, { workflow_run_id: workflowRunId });
      break;
    }

    case "employee.status_changed": {
      const empUserId = event.payload.user_id
        ?? await resolveTenant(xano, "employee", event.payload.employee_id);
      await xano.post("/employees/upsert", { ...event.payload, user_id: empUserId });
      await ensureTenantMapping(xano, "employee", event.payload.employee_id, empUserId);
      await redis.del(`cache:employee-roster:${empUserId}`);
      break;
    }

    case "employee.unavailability": {
      const unavailUserId = event.payload.user_id
        ?? await resolveTenant(xano, "employee", event.payload.employee_id);
      // Upsert to employee_unavailabilities table (not a field on employees)
      await xano.post("/employee_unavailabilities/upsert", { ...event.payload, user_id: unavailUserId });
      await ensureTenantMapping(xano, "employee", event.payload.employee_id, unavailUserId);
      await redis.del(`cache:employee-roster:${unavailUserId}`);
      break;
    }

    case "visit.created":
    case "visit.updated": {
      const visitUserId = event.payload.user_id
        ?? await resolveTenant(xano, "visit", event.payload.visit_id);
      await xano.post("/visits/upsert", { ...event.payload, user_id: visitUserId });
      await ensureTenantMapping(xano, "visit", event.payload.visit_id, visitUserId);
      break;
    }

    case "visit.cancelled": {
      const cancelUserId = event.payload.user_id
        ?? await resolveTenant(xano, "visit", event.payload.visit_id);
      await xano.patch(`/visits/${event.payload.visit_id}`, { status: "cancelled", user_id: cancelUserId });
      await ensureTenantMapping(xano, "visit", event.payload.visit_id, cancelUserId);

      // Cancel any active roster tasks AND their running workflows.
      // IMPORTANT: Cancel workflows FIRST (time-sensitive — stops SMS sends),
      // then PATCH task status (can tolerate a few seconds of delay).
      const activeTasks = await xano.get(`/roster_tasks/by-visit/${event.payload.visit_id}`, { user_id: cancelUserId });
      const wfClient = new Client({ token: process.env.QSTASH_TOKEN! });

      // Phase 1: Cancel all workflows immediately (fire-and-forget)
      await Promise.all(
        activeTasks
          .filter((t: { workflow_run_id?: string }) => t.workflow_run_id)
          .map((t: { workflow_run_id: string }) =>
            wfClient.cancel({ ids: [t.workflow_run_id] }).catch(() => {
              // Workflow may have already completed — safe to ignore
            })
          )
      );

      // Phase 2: Update task status + audit log
      for (const task of activeTasks) {
        await xano.patch(`/roster_tasks/${task.id}`, {
          status: "cancelled",
          resolved_at: new Date().toISOString(),
        });
        await xano.post("/audit_log", {
          task_id: task.id,
          action: "cancelled_visit_withdrawn",
          actor: "system",
          details: { visit_id: event.payload.visit_id },
          idempotency_key: `${task.id}-cancelled_visit_withdrawn-${event.event_id}`,
        });
      }
      break;
    }

    case "client.created": {
      const clientUserId = event.payload.user_id
        ?? await resolveTenant(xano, "client", event.payload.client_id);
      await xano.post("/clients/upsert", { ...event.payload, user_id: clientUserId });
      await ensureTenantMapping(xano, "client", event.payload.client_id, clientUserId);
      break;
    }
  }
}

// QStash signature verification middleware
export const POST = verifySignatureAppRouter(handler);
```

---

## Rate Limiting — Upstash Redis

Replace the template's in-memory rate limiter with Upstash Redis for multi-instance durability.

```typescript
// src/lib/rate-limit.ts
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

// Per-user API rate limiting (proxy requests)
export const apiLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(120, "1 m"),
  prefix: "rl:api",
});

// Login rate limiting (replaces in-memory limiter)
export const loginLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(5, "15 m"),
  prefix: "rl:login",
});

// Webhook ingress rate limiting
export const webhookLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.tokenBucket(100, "1 s", 200),
  prefix: "rl:webhook",
});

// Bedrock LLM quota management
export const bedrockLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.fixedWindow(20, "1 m"),
  prefix: "rl:bedrock",
});

// AlayaCare outbound API protection
export const alayacareLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(50, "1 m"),
  prefix: "rl:alayacare",
});

// Xano outbound API protection — prevents cascading failure during
// workflow bursts (50 visit.vacated events × 7+ Xano calls per step).
// Shared across all workflow instances.
export const xanoLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(200, "1 m"),
  prefix: "rl:xano",
});
```

---

## Caching — Upstash Redis

Server-side caching for expensive or frequently-accessed data. Client-side caching remains with TanStack Query (no change).

```typescript
// src/lib/cache.ts
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

// Cache employee roster for scoring engine (30s TTL).
// Cache key is tenant-scoped to prevent cross-tenant data leakage —
// without the userId suffix, one tenant's cached roster would be
// served to the next tenant that hits scoring.
export async function getCachedEmployeeRoster(xano: XanoClient, userId: string): Promise<Employee[]> {
  const key = `cache:employee-roster:${userId}`;
  const cached = await redis.get<Employee[]>(key);
  if (cached) return cached;

  const roster = await xano.get("/employees/roster");
  await redis.set(key, roster, { ex: 30 });
  return roster;
}

// Distributed lock for scoring deduplication
export async function acquireScoringLock(visitId: number): Promise<boolean> {
  const acquired = await redis.set(`lock:scoring:${visitId}`, "1", { ex: 30, nx: true });
  return acquired === "OK";
}

export async function releaseScoringLock(visitId: number): Promise<void> {
  await redis.del(`lock:scoring:${visitId}`);
}
```

---

## Human Actions — PATCH via Proxy

When a coordinator takes action on an escalated task (via the UI), the request goes through the standard proxy pattern to Xano, which updates the task. If the action requires workflow interaction (e.g., cancel), the API route also notifies the workflow.

```typescript
// Xano: POST /roster_tasks/{id}/action (function stack)
//
// Input: { action, employee_id?, reason? }
// Logic:
//   - Validate task is in actionable state (escalated for most actions)
//   - Apply action:
//     - accept_recommendation: set status=accepted (NOT assigned yet)
//     - assign_manually: set status=accepted, assigned_employee_id=input.employee_id
//     - defer: no status change, append audit
//     - take_over: set status=assigned, append audit with reason
//     - cancel: set status=cancelled, resolved_at=now
//   - Append audit log entry
//   - Return updated task
//
// IMPORTANT: accept_recommendation and assign_manually set status to "accepted"
// (not "assigned"). The Next.js handler must then write back to AlayaCare to
// create the offer. Only after AlayaCare confirms is the task marked "assigned".
// This matches the workflow's pattern — never mark "assigned" without AlayaCare
// confirmation to prevent data divergence.
```

The Next.js handler for human actions that require AlayaCare write-back:

```typescript
// app/api/roster/tasks/[id]/action/route.ts
export async function POST(req: Request) {
  // ... auth, validation, parse HumanActionInput ...

  // Step 1: Update task in Xano (status → "accepted")
  const updatedTask = await xano.post(`/roster_tasks/${taskId}/action`, input);

  // Step 2: For assignment actions, write back to AlayaCare
  if (input.action === "accept_recommendation" || input.action === "assign_manually") {
    const employeeId = input.employee_id ?? updatedTask.assigned_employee_id;
    try {
      await alayaFetch(`/scheduler/visits/${updatedTask.visit_id}/offers`, {
        method: "POST",
        body: { employee_id: employeeId },
        headers: {
          "Idempotency-Key": `roster-${taskId}-human-offer-${employeeId}`,
        },
      });
      // AlayaCare confirmed — now mark as "assigned"
      await xano.patch(`/roster_tasks/${taskId}`, {
        status: "assigned",
        assigned_employee_id: employeeId,
        resolved_at: new Date().toISOString(),
      });
    } catch (err) {
      // Write-back failed — escalate, do NOT mark as assigned
      await xano.patch(`/roster_tasks/${taskId}`, {
        status: "escalated",
        escalation_reason: `AlayaCare write-back failed: ${String(err)}`,
      });
      return Response.json(
        { error: "AlayaCare write-back failed — task re-escalated" },
        { status: 502 }
      );
    }
  }

  return Response.json(updatedTask);
}
```

For tasks that have an active workflow (status is `contacting`), the Next.js route handler also cancels the workflow:

```typescript
// app/api/roster/tasks/[id]/cancel/route.ts
import { Client } from "@upstash/workflow";

export async function POST(req: Request) {
  // ... auth, validation ...
  const workflowClient = new Client({ token: process.env.QSTASH_TOKEN! });

  // Cancel the running workflow
  const task = await xano.get(`/roster_tasks/${taskId}`);
  if (task.workflow_run_id) {
    await workflowClient.cancel({ ids: [task.workflow_run_id] });
  }

  // Update task in Xano
  await xano.patch(`/roster_tasks/${taskId}`, {
    status: "cancelled",
    resolved_at: new Date().toISOString(),
  });

  return Response.json({ ok: true });
}
```

---

## Auth Model

### Standard CRUD Requests

Follow the template pattern exactly:

1. User logs in via Xano `/auth/login`
2. Auth token stored in HMAC-signed httpOnly cookie
3. All CRUD goes through `POST /api/proxy` which attaches the token
4. Edge middleware validates session signature before page render

### Webhook + Workflow Requests

These are **not user-initiated** — they're M2M (machine-to-machine):

| Endpoint | Auth Mechanism |
|---|---|
| `POST /api/webhooks/alayacare` | `x-webhook-secret` header (shared secret) |
| `POST /api/webhooks/process-event` | QStash signature verification (`verifySignatureAppRouter`) |
| `POST /api/roster/workflow` | QStash signature verification (Upstash calls this) |
| `POST /api/webhooks/sms-response` | SMS provider callback verification (e.g., Twilio signature) |

Xano access from workflow/webhook handlers uses a **service token** — a long-lived Xano API key stored in `XANO_SERVICE_TOKEN` env var. This is not a user token; it bypasses user-level auth.

**Tenant isolation for service-token requests**: The workflow body receives `userId` in its payload and passes it to `createXanoClient("roster", token, { userId })`. The Xano client injects `userId` as a query/body parameter on every request. All Xano API endpoints (including service-token endpoints) **must enforce** `WHERE user_id = :userId` — this is validated by Xano's function stack, not by auth middleware. Without this, service-token calls would return cross-tenant data.

**Tenant resolution in webhooks**: AlayaCare webhooks do not include a tenant identifier. Webhook handlers resolve `userId` from the `tenant_mapping` table (see Reference Tables section) using the external AlayaCare ID. This lookup does not require tenant context — it maps external IDs to tenant ownership. The `tenant_mapping` endpoint is the **only** Xano endpoint exempt from the `WHERE user_id = :userId` requirement. All subsequent calls in the handler use the resolved `userId`.

---

## Idempotency Design

Upstash Workflow guarantees **at-least-once** execution per step. If a step completes but the network drops before confirmation, the step re-executes. All side effects inside `context.run()` must be idempotent.

### Critical Idempotency Points

| Operation | Risk if Non-Idempotent | Mitigation |
|---|---|---|
| **AlayaCare offer creation** | Duplicate offers sent to caregiver | Include `idempotency_key` in API call (e.g., `roster-task-{taskId}-offer-{employeeId}`) |
| **Xano task status update** | Status set to same value twice — harmless | No action needed (PATCH is naturally idempotent) |
| **Audit log append** | Duplicate audit entries | Include `idempotency_key` in audit entry; Xano unique constraint on `(task_id, action, idempotency_key)` |
| **SMS/email send** | Caregiver receives duplicate contact | Use provider-level idempotency key (Twilio `idempotency_key` header, SES `MessageDeduplicationId`) |
| **Redis cache invalidation** | Cache cleared twice — harmless | No action needed |

### AlayaCare Idempotency Pattern

```typescript
await context.run("alayacare-writeback", async () => {
  try {
    await alayaFetch(`/scheduler/visits/${visitId}/offers`, {
      method: "POST",
      body: { employee_id: candidate.employee_id },
      headers: {
        // Idempotency key prevents duplicate offers on retry
        "Idempotency-Key": `roster-${taskId}-offer-${candidate.employee_id}`,
      },
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
});
```

---

## Developer Discipline — Workflow Re-Execution Model

Upstash Workflow re-executes the entire `serve()` function on each step resumption. Completed steps are skipped (their stored result is returned immediately), but **code outside `context.run()` executes every time**.

### Rules

1. **No side effects outside `context.run()`** — API calls, database writes, logging, analytics must be inside a step. Code outside steps runs multiple times.

2. **No non-deterministic values outside steps** — `Date.now()`, `Math.random()`, `crypto.randomUUID()` outside a step produce different values on each re-execution. Use `context.run()` to capture these once.

3. **Stateless client creation is safe outside steps** — `createXanoClient()` creates a fresh HTTP client with no side effects. This is intentionally outside steps (it runs on every resumption, which is fine).

4. **Pure computation is safe outside steps** — `getUrgencyConfig(urgency)` is a pure function. Same input always produces same output. Safe to call outside steps.

### What Goes Wrong If You Violate This

```typescript
// WRONG — runs on every step resumption, appending duplicate entries
await xano.post("/audit_log", { action: "workflow_started" });
await context.run("step-1", () => { ... });

// CORRECT — runs exactly once, result stored in workflow journal
await context.run("log-start", () =>
  xano.post("/audit_log", { action: "workflow_started" })
);
await context.run("step-1", () => { ... });
```

### Code Review Checklist for Workflow Code

- [ ] Every API call is inside a `context.run()`, `context.call()`, or `context.waitForEvent()`
- [ ] No `Date.now()`, `Math.random()`, or `crypto.randomUUID()` outside steps
- [ ] All side effects (DB writes, SMS sends, cache invalidation) are inside steps
- [ ] AlayaCare API calls include idempotency keys
- [ ] SMS/email sends include provider-level deduplication
- [ ] Every `xano.post("/audit_log", ...)` includes `idempotency_key`
- [ ] Every direct PATCH to `roster_tasks` checks terminal status first (or relies on Xano 409)
- [ ] Contact array appends check for existing `employee_id` to prevent duplicates on retry
- [ ] Scoring lock acquired before scoring step (`acquireScoringLock`)

---

## Data Residency — Region Considerations

Upstash runs on AWS. For Australian health data (Dovida/AlayaCare), data residency requirements may apply.

### Decision Points

| Service | Region Requirement | Status |
|---|---|---|
| **Upstash Redis** | Available in ap-southeast-2 (Sydney) | Verify at provisioning |
| **Upstash QStash** | Messages processed in closest region | Verify ap-southeast-2 availability |
| **Upstash Workflow** | Steps execute on YOUR compute (Next.js) | Data stays where your app is hosted |
| **Xano** | Database region configurable | Set to Australian region |
| **AWS Bedrock** | ap-southeast-2 supported | Haiku 4.5 available in Sydney |

**Key insight**: Upstash Workflow steps execute on **your** infrastructure (your Next.js API routes), not on Upstash's servers. Upstash only stores the step journal (step names + serialised return values). Ensure return values from `context.run()` don't contain PII — return only IDs and status flags, not patient/client data.

### Mitigation Pattern

```typescript
// CORRECT — return only the status, not client data
const matchResult = await context.run("score", async () => {
  const result = computeMatch(visit, employees, config);
  // Store full result in Xano (your controlled region)
  await xano.patch(`/roster_tasks/${taskId}`, { match_result: result });
  // Return only metadata to workflow journal (stored by Upstash)
  return { candidateCount: result.candidates.length, topScore: result.candidates[0]?.overall };
});
```

---

## Platform Risk

### Upstash Kafka Deprecation Precedent

Upstash deprecated Kafka in September 2024, redirecting resources to QStash and Workflow. This demonstrates willingness to kill products with active users.

**Mitigation**: The architecture is designed so that Xano is the source of truth for all data. If Upstash were discontinued:
- **Redis** — any Redis provider works (ElastiCache, Railway Redis, Dragonfly). `@upstash/ratelimit` has no lock-in beyond the Redis protocol.
- **QStash** — webhook processing moves to a simple retry queue (BullMQ, SQS, or even in-process retry logic).
- **Workflow** — the workflow code is ~80 lines of async/await. It could be ported to Inngest, Restate, or a custom orchestrator. The business logic (scoring, reasoning, cascade) is in pure TypeScript functions that don't depend on Upstash.

No business data lives exclusively in Upstash. The blast radius of a platform discontinuation is the orchestration glue, not the domain logic.

---

## Environment Variables

```bash
# Xano
XANO_BASEURL=https://your-instance.xano.io/api
XANO_DATASOURCE=                           # Optional
XANO_BRANCH=                               # Optional
XANO_SERVICE_TOKEN=                        # M2M token for workflow/webhook handlers
                                           # Security: create a dedicated Xano API group
                                           # with access limited to roster_tasks, audit_log,
                                           # employees, clients, visits, and daily_metrics.
                                           # Do NOT use an admin-level token. Rotate quarterly.

# Auth
SESSION_SECRET=                            # 32+ char random string (HMAC signing)

# Upstash Redis
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

# Upstash QStash
QSTASH_TOKEN=
QSTASH_CURRENT_SIGNING_KEY=               # For verifySignatureAppRouter
QSTASH_NEXT_SIGNING_KEY=

# AlayaCare
ALAYACARE_API_URL=
ALAYACARE_PUBLIC_KEY=
ALAYACARE_PRIVATE_KEY=
ALAYACARE_WEBHOOK_SECRET=

# AWS Bedrock
AWS_REGION=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=

# Tenant resolution
DEFAULT_TENANT_ID=                         # Fallback for single-tenant deployments.
                                           # Used when resolveTenant() finds no mapping
                                           # (e.g. new AlayaCare resource after bulk import).
                                           # For multi-tenant: use per-tenant webhook URLs instead.

# App
APP_URL=https://your-app.vercel.app        # For QStash/Workflow callbacks
```

---

## Migration from Current Architecture

### What Changes

| Current | New |
|---|---|
| Supabase PostgreSQL + Drizzle ORM | Xano (tables + CRUD endpoints) |
| `src/db/schema.ts` (Drizzle schema) | Xano table definitions (via Xano UI) |
| `src/services/*-service.ts` (data access) | Xano API calls via SDK or proxyFetch |
| `src/server/uow/` (UnitOfWork) | Removed — Xano handles persistence |
| `src/server/require-auth-context.ts` | Template session pattern (`getSession()`) |
| `src/server/commands/` + `queries/` | Xano endpoints + template proxy pattern |
| `workflow-orchestrator.ts` (switch) | Upstash Workflow (`serve()`) |
| `WebhookDebouncer` | QStash deduplication |
| Two-layer idempotency | QStash `deduplicationId` |
| `AlayaCareCache` (in-memory) | Upstash Redis cache |
| In-memory rate limiter | Upstash Redis rate limiter |
| `src/lib/alayacare-client.ts` | Retained for outbound AlayaCare API calls (write-back). Reads come from Xano (synced tables) |
| `src/auth/` (Supabase Auth) | Xano auth + template session pattern |

### What Stays

| Module | Status |
|---|---|
| `src/services/scoring/` (11 files) | **Unchanged** — pure functions, data source changes from `alayaFetch` to Xano |
| `src/services/reasoning/` (7 files) | **Unchanged** — Bedrock integration, prompt engineering |
| `src/services/recommendation-context.ts` | **Minor change** — reads from Xano instead of AlayaCare |
| `src/services/rostering/cascade-engine.ts` | **Unchanged** — pure functions |
| `src/services/rostering/urgency-classifier.ts` | **Unchanged** — pure function |
| `src/services/rostering/data-validator.ts` | **Unchanged** — pure function |
| `src/services/rostering/outcome-tracker.ts` | **Unchanged** — pure function |
| `src/services/rostering/pattern-recognition.ts` | **Minor change** — queries Xano instead of Drizzle |
| All unit tests for pure functions | **Unchanged** — scoring, cascade, urgency, validation tests |

### What's Removed

| Module | Reason |
|---|---|
| `src/db/` (Drizzle schema + client) | Replaced by Xano |
| `src/server/uow/` (UnitOfWork) | Replaced by Xano transactions (where needed) |
| `src/server/make-deps.ts` | Replaced by template proxy pattern |
| `src/server/policies/` | Replaced by Xano auth/permissions |
| `src/server/commands/` + `queries/` | Replaced by Xano endpoints + workflow |
| `workflow-orchestrator.ts` | Replaced by Upstash Workflow |
| `advance-roster-task.ts` | Replaced by workflow trigger |
| `process-pending-events.ts` | Replaced by QStash → workflow trigger |
| `src/lib/webhook-debouncer.ts` | Replaced by QStash deduplication |
| `src/lib/alayacare-cache.ts` | Replaced by Upstash Redis cache |
| `src/auth/` (Supabase module) | Replaced by Xano auth + template session |
| `src/lib/supabase/` | Replaced by Xano SDK |

---

## Chat Interface / SSE Streaming

The current system includes a conversational UI with 7 chat tools (4 read + 3 write) and an SSE streaming endpoint. The template's proxy pattern does not support SSE (it's request/response only), so the chat interface requires custom Next.js routes.

### Chat Read Tools → Xano Queries via Proxy

Read tools (`get_task_status`, `query_metrics`, `list_recent_tasks`, `count_tasks_by_status`) translate to Xano CRUD queries. These can use the standard `proxyFetch` pattern from within the chat handler.

### Chat Write Tools → Workflow Triggers

Write tools that modify roster task state must interact with the workflow:

| Chat Tool | Action |
|---|---|
| `create_roster_task` | Create task in Xano → trigger Upstash Workflow |
| `assign_caregiver` | Notify workflow via `client.notify()` (same as SMS response) |
| `cancel_task` | Cancel workflow via `client.cancel()` + update Xano |

### SSE Streaming Route

The SSE stream route (`POST /api/chat/stream`) is a **custom Next.js route** that:
1. Receives user message
2. Calls Bedrock LLM with tool definitions
3. Streams responses via `createSSEResponse()`
4. When LLM invokes a write tool, sends `confirmation_required` event
5. On user confirmation, executes the write action (Xano CRUD or workflow trigger)

This route bypasses the proxy pattern entirely — it's a direct Next.js API route that manages its own auth (reads session cookie directly) and orchestrates between Bedrock, Xano, and Upstash.

```typescript
// app/api/chat/stream/route.ts — custom route, NOT proxied
// Auth: reads session cookie directly via getSession()
// LLM: calls Bedrock via existing reasoning service
// Tools: read tools → Xano SDK, write tools → Xano SDK + workflow client
// Response: Server-Sent Events via createSSEResponse()
```

---

## Observability

See [`observability-plan.md`](./observability-plan.md) for the full monitoring strategy. Two tiers:

- **Option A (zero cost)**: Upstash Console + Vercel Dashboard + structured logging + custom metrics endpoint + Slack webhook alerts
- **Option B (Datadog, $15/month)**: Full APM with distributed tracing across webhook → QStash → workflow → Xano/Bedrock/AlayaCare, custom dashboards, threshold-based alerting

Recommendation: start with Option A, upgrade to Option B when debugging production workflow issues across multiple services becomes a bottleneck.

---

## Cost Estimate

| Service | Free Tier | Expected Usage | Monthly Cost |
|---|---|---|---|
| **Xano** | (varies by plan) | Database + CRUD + auth | Xano plan cost |
| **Upstash Redis** | 500K commands/month | Rate limiting + caching | $0 (free tier likely sufficient) |
| **Upstash QStash** | 1,000 messages/day | Webhooks + workflow steps | $0 (free) to $1/100K messages |
| **Upstash Workflow** | Uses QStash messages | ~7 steps × N tasks/day | Included in QStash cost |
| **AWS Bedrock** | Pay per token | LLM reasoning per task | ~$0.001-0.01 per task |
| **Vercel** | Hobby tier | Next.js hosting | $0-20/month |

A 7-step workflow costs ~7 QStash messages per run. At 100 roster tasks/day = 700 messages/day, well within the free tier (1,000/day). Scaling to 500 tasks/day = 3,500 messages/day = ~$1.05/month.

**Xano API call volume**: QStash costs are per workflow step (correct), but each step makes 2-4 Xano calls (read task + PATCH + audit log + tenant mapping). Actual Xano call volume per task:
- Sequential cascade (5 contacts): ~35 Xano API calls (score: 3, reason: 2, per contact: 4 send + 3 result, finalize: 3)
- Parallel cascade (5 contacts): ~25 Xano API calls (score: 3, reason: 2, batch send: 6, per poll: 3, finalize: 3)
- At 100 tasks/day: ~2,500-3,500 Xano API calls/day
