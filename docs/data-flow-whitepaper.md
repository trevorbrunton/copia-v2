# DappaAi Data Flow & Data Model White Paper

## Executive Summary

DappaAi is an autonomous rostering platform for home care organisations. It ingests shift vacancy events from a care management system, scores available caregivers across five weighted dimensions, applies LLM-based reasoning to produce a recommendation, and then orchestrates caregiver contact through an automated cascade — all while maintaining a complete audit trail and surfacing real-time insights through a conversational interface.

This document describes how data moves through the platform, the entities that store it, and the decisions each layer makes as data passes through.

---

## 1. System Context

DappaAi sits between three boundaries:

| Boundary | Direction | What flows |
|----------|-----------|------------|
| **Care management system** | Inbound (webhooks, API reads) | Visits, employees, clients, skills, offers, schedules |
| **Caregivers** | Outbound (SMS / email) | Shift offer notifications; inbound acceptance or decline |
| **Coordinators** | Bidirectional (browser) | Dashboard views, manual overrides, conversational queries |

The platform never duplicates the care management system's master data. Employees, visits, clients, and skills are always read live (or from a short-lived cache). Only decision artefacts — roster tasks, audit entries, metrics, and user accounts — are persisted locally.

---

## 2. Data Model

### 2.1 Locally Persisted Entities

#### User & Identity

| Entity | Purpose | Key fields |
|--------|---------|------------|
| **User** | Platform operator identity | `id`, `email`, `name`, `status` (active · suspended · soft_deleted), `timezone`, `locale`, login counters |
| **User Session** | Active login session | `id`, `userId`, `deviceId`, `status`, `ipAddress`, `startedAt`, `expiresAt`, `lastActiveAt` |
| **User Device** | Recognised device fingerprint | `id`, `userId`, `deviceFingerprint`, `deviceType`, `os`, `browser`, `trusted` |
| **User Status History** | Immutable audit of status transitions | `fromStatus`, `toStatus`, `reason`, `changedBy`, `ipAddress` |

**User status machine:**

```
active ──→ suspended ──→ active   (reactivation)
  │
  └──→ soft_deleted               (self-service, 30-day purge window)
```

#### Rostering

| Entity | Purpose | Key fields |
|--------|---------|------------|
| **Roster Task** | A shift-filling work item driven by the state machine | `visitId`, `clientId`, `status`, `urgency`, `version` (optimistic lock), `matchResult` (JSON), `llmRecommendation` (JSON), `contacts` (JSON array), `assignedEmployeeId`, `escalationReason`, timing timestamps |
| **Roster Audit Log** | Append-only record of every action on a task | `taskId`, `action`, `actor` (system · llm · user-id), `details` (JSON), `reasoning` |
| **Roster Daily Metrics** | Materialised daily roll-up per user | `date`, `tasksCreated`, `tasksFilledAutonomous`, `tasksEscalated`, `avgTimeToFillMs`, `firstContactAcceptanceRate` |

#### Workflow Events

| Entity | Purpose | Key fields |
|--------|---------|------------|
| **Workflow Event** | Idempotent record of every inbound webhook | `eventId` (unique), `eventType`, `source`, `payload` (JSON), `status` (received · completed · failed), `traceId`, `result`, `error` |

#### Conversation

| Entity | Purpose | Key fields |
|--------|---------|------------|
| **Chat Conversation** | A coordinator chat session | `userId`, `title` |
| **Chat Message** | Individual message in a conversation | `conversationId`, `role` (user · assistant), `content` |

### 2.2 External Entities (Read-Only from Care Management System)

These entities are never stored locally. They are fetched on demand and, where noted, cached briefly.

| Entity | Shape | Usage |
|--------|-------|-------|
| **Visit** | `id`, `client_id`, `employee_id`, `start_at`, `end_at`, `status`, `service_instructions`, `clock_in`, `clock_out` | Primary unit of work — a scheduled home care shift |
| **Client** | `id`, `first_name`, `last_name`, `latitude`, `longitude`, `city`, `state` | Care recipient; location used for proximity scoring |
| **Employee** | `id`, `username`, `status`, `latitude`, `longitude`, `demographics` (name, email, phone, address) | Caregiver; location + status used for scoring and constraints |
| **Skill** | `employee_id`, `skill_id`, `acquired_date`, `expired_date` | Qualification held by an employee; used for hard constraint and skill-match scoring |
| **Visit Offer** | `id`, `visit_id`, `employee_id`, `status`, `decline_reason`, `offered_at`, `responded_at` | Historical acceptance / decline record; feeds acceptance-likelihood scoring |
| **Employee Roster** | Aggregated list of all active employees + their skills | **Cached for 30 seconds** with stampede prevention; the single most expensive fetch, shared across scoring calls |

---

## 3. Data Flow: End-to-End Shift Filling

The autonomous rostering pipeline follows this sequence:

```
Webhook event (visit vacated)
        │
        ▼
  ┌─────────────┐
  │  Validation  │  M2M secret check, Zod schema, idempotency guard
  └──────┬──────┘
         │
         ▼
  ┌─────────────┐
  │  Debouncer   │  Batches scoring-heavy events within a ~2 s window
  └──────┬──────┘
         │
         ▼
  ┌─────────────┐
  │  Dispatcher  │  Routes event to registered handler by type
  └──────┬──────┘
         │
         ▼
  ┌─────────────────────────────────────────────┐
  │             Scoring Engine                   │
  │  1. Bulk-fetch visit, client, employee       │
  │     roster (cached), schedules, offers       │
  │  2. Hard-constraint filter (schedule,        │
  │     skills, status)                          │
  │  3. Score 5 dimensions (skills, relation-    │
  │     ship, proximity, workload, acceptance)   │
  │  4. Weighted rank + confidence label         │
  └──────┬──────────────────────────────────────┘
         │  MatchResult (ranked candidates +
         │  pre-fetched visit/client data)
         ▼
  ┌─────────────────────────────────────────────┐
  │           LLM Reasoning Layer                │
  │  1. Build prompt (visit, client, scores,     │
  │     data-quality warnings, weight preset)    │
  │  2. LLM call (low temperature, 1 024 tokens)│
  │  3. Parse + validate JSON response           │
  │  → Primary recommendation (employee,         │
  │    confidence, explanation)                   │
  │  → Escalation decision (should_escalate,     │
  │    urgency, reason)                          │
  │  → Factors considered, trade-offs            │
  └──────┬──────────────────────────────────────┘
         │  LLMRecommendation
         ▼
  ┌─────────────────────────────────────────────┐
  │           Roster Orchestrator                │
  │  State machine advances task:                │
  │  detected → gathering → scoring → reasoning  │
  │  → contacting → cascading → accepted         │
  │  → assigned / escalated / completed          │
  └──────┬──────────────────────────────────────┘
         │
         ├──→ SMS / email to caregiver(s)
         │
         └──→ Audit log + daily metrics
```

### 3.1 Webhook Ingestion

When the care management system fires an event (e.g. `visit.vacated`, `employee.status_changed`):

1. **Authentication** — a shared secret in the request header is compared in constant time.
2. **Schema validation** — the event body is validated against a Zod schema covering nine event types.
3. **Idempotency** — a two-layer check (SELECT then unique constraint) prevents duplicate processing.
4. **Recording** — the raw event is persisted to `workflow_events` with status `received` and a unique `traceId`.
5. **Routing** — scoring-heavy events (`visit.vacated`, `visit.created`, `visit.updated`) enter a debounce buffer; all others dispatch immediately.
6. **Dispatch** — a handler registry maps each event type to a handler function.
7. **Completion** — the workflow event record is updated to `completed` or `failed` with result or error detail.

**Debouncing** exists because a single real-world event (e.g. an employee leaving) can trigger dozens of `visit.vacated` webhooks in quick succession. The debouncer collects events for a configurable window (default 2 seconds), then processes them sequentially. The first event in the batch warms the employee roster cache; subsequent events reuse it.

### 3.2 Scoring Engine

The scoring engine answers: *"Which available caregivers are the best fit for this shift?"*

**Input:** A visit ID and a weight configuration (preset or custom).

**Phase 1 — Data assembly.** The engine fetches the visit detail, the client record (for location), the full employee roster with skills (from cache), each employee's schedule for the visit day, the client's visit history by employee, and historical offer outcomes.

**Phase 2 — Hard constraints.** Binary pass/fail filters eliminate candidates who:
- Are not in `active` status.
- Have a schedule conflict overlapping the visit window.
- Lack a required skill, or hold one that has expired.

**Phase 3 — Five-dimension scoring.** Each surviving candidate receives a normalised score (0–1) on five dimensions:

| Dimension | What it measures | Signal |
|-----------|-----------------|--------|
| **Skills** | How well the caregiver's qualifications match the visit's requirements | Ratio of valid matched skills to required skills |
| **Relationship** | Prior care history with this client | Logarithmic count of past visits, discounted by a stepped recency multiplier (1.0 within 7 days, decaying to 0.4 beyond 90 days) |
| **Proximity** | Geographic closeness to the client | Haversine distance with linear decay |
| **Workload** | Balance relative to peers | Gaussian distribution around pool mean; asymmetric penalty for overload |
| **Acceptance** | Likelihood of accepting the offer | Ratio of accepted to resolved offers, with exponential decay on historical contacts |

A weighted sum produces an overall score. Five preset weight profiles target different scenarios:

| Preset | Skills | Relationship | Proximity | Workload | Acceptance |
|--------|--------|-------------|-----------|----------|------------|
| Planned (default) | 20 % | 30 % | 15 % | 20 % | 15 % |
| Urgent | 15 % | 10 % | 25 % | 10 % | 40 % |
| High-value client | 15 % | 35 % | 15 % | 10 % | 25 % |
| New client | 25 % | 5 % | 20 % | 25 % | 25 % |
| Efficiency | 15 % | 10 % | 30 % | 30 % | 15 % |

**Phase 4 — Ranking and confidence.** Candidates are sorted by overall score. A distribution-based algorithm assigns a match confidence level (high, medium, low) to the result set. Data-quality warnings (missing coordinates, no required skills, inactive employees filtered, etc.) are collected throughout.

**Output:** A `MatchResult` containing ranked candidates with per-dimension breakdowns, the weight configuration used, pool sizes, data warnings, and — critically — the pre-fetched visit and client data, carried forward so downstream consumers never re-fetch them.

### 3.3 LLM Reasoning Layer

The reasoning layer answers: *"Given these scores and context, which caregiver should we recommend — and should a human review this?"*

**Input:** The visit context, client context, and the full `MatchResult` including all scored candidates and data-quality warnings.

**Prompt construction.** A structured prompt is built with:
- Shift details (date, time, urgency, service instructions).
- Client information (name, location, care needs).
- Match confidence and data-quality warnings.
- Each candidate's rank, overall score, per-dimension scores and reasons.
- The weight preset and percentages used.

**LLM call.** The prompt is sent at low temperature (0.3) for consistent rostering decisions, with a 1 024-token output cap.

**Response parsing.** The LLM returns a JSON payload validated against a strict schema:

```
LLMRecommendation
├── primary
│   ├── employee_id        — the recommended caregiver
│   ├── employee_name
│   ├── explanation         — human-readable rationale
│   └── confidence          — high · medium · low
├── escalation
│   ├── should_escalate     — boolean
│   ├── reason              — why (or null)
│   └── urgency             — immediate · before_shift · informational
├── factors_considered[]    — what the LLM weighed
└── trade_offs[]            — competing considerations
```

**Escalation triggers** encoded in the system prompt include: no candidates above 0.5, low confidence on skills, expired qualifications, conflicting data, fewer than three viable candidates, high-priority client with no prior relationship, and LLM uncertainty.

**Fallback.** If the LLM call fails, the pipeline continues with an error discriminator containing the top-scored candidate from Phase 3. Rostering does not stop because the reasoning layer is unavailable.

### 3.4 Roster Orchestrator (State Machine)

The orchestrator drives each roster task through a defined lifecycle:

```
detected → gathering → scoring → reasoning → contacting → cascading
                                                              │
                                              ┌───────────────┤
                                              ▼               ▼
                                           accepted       escalated
                                              │
                                              ▼
                                        assigned / completed
```

**Terminal states:** `assigned`, `escalated`, `completed`, `cancelled`.

Each transition follows a three-phase pattern:

1. **Read state** — fetch the current task inside a transaction.
2. **External calls** — scoring, LLM, or care management system writes happen *outside* the transaction so database connections are not held during network I/O.
3. **Persist results** — a fresh read of the task inside a new transaction, with an optimistic-lock version check, prevents time-of-check/time-of-use races.

**Key transitions:**

| From | To | What happens |
|------|----|-------------|
| scoring | reasoning or escalated | LLM reasoning runs; if fewer than 3 candidates, escalate immediately |
| reasoning | contacting or escalated | If LLM says `escalation.urgency = "immediate"`, escalate; otherwise begin contact |
| contacting | cascading | Current contact's expiry window elapses without response |
| cascading | contacting, accepted, or escalated | Next candidate contacted (sequential) or all contacted (parallel); cascade exhaustion triggers escalation |
| accepted | assigned or completed | Write-back to care management system; failure triggers escalation |

**Cascade strategies:**
- **Sequential** (planned shifts): contact rank 1 → wait for expiry (60 min) → contact rank 2 → etc.
- **Parallel** (urgent shifts): contact top-N simultaneously (15 min expiry) → first acceptance wins → remaining offers cancelled.

**Contact attempt data** accumulated on the task record:

```
ContactAttempt
├── employee_id, employee_name
├── rank, overall_score
├── channel (sms · email)
├── sent_at, expires_at
├── response (pending · accepted · declined · expired)
├── responded_at, decline_reason
└── selection_reason
```

**Audit trail.** Every state transition appends a row to `roster_audit_log` with the action name, the actor (system, llm, or a user ID), structured details, and optional reasoning text.

**Metrics.** On task resolution, `roster_daily_metrics` is updated: tasks created, tasks filled autonomously, tasks escalated, average time-to-fill, and first-contact acceptance rate.

### 3.5 Acceptance Feedback Loop

The acceptance-likelihood scorer merges two data sources:

1. **Historical offer data** from the care management system — accepted and declined offers per employee.
2. **Contact outcome data** from DappaAi's own roster task history — accepted, declined, and expired contact attempts.

Both sources apply exponential decay with a 30-day half-life, giving recent behaviour more weight. This creates a closed feedback loop: each rostering cycle's outcomes improve the next cycle's predictions.

---

## 4. Data Flow: Coordinator Interactions

### 4.1 Dashboard & Detail Views

Coordinators interact with the platform through a browser-based dashboard.

**Authentication flow:**
```
Email + password → Identity provider → Session cookie
                                        │
                    ┌───────────────────┘
                    ▼
              Session created (30-day TTL)
              Device registered (fingerprint)
              Heartbeat every 15 minutes
```

**Data fetching pattern.** Every client-side view fetches data through a centralised API client that:
- Attaches the session cookie (or Bearer token on mobile).
- Intercepts 403 responses to detect suspended or deleted accounts.
- Uses a query cache with automatic invalidation on mutations.

**Browse flows:**

| View | Data source | Flow |
|------|-------------|------|
| Client list | Care management API (proxied) | Browser → API route → care management system → response |
| Employee list | Care management API (proxied) | Same proxy pattern |
| Visit list | Care management API (proxied, with filters) | Supports status, date range, client, employee filters |
| Visit detail | Care management API + local roster data | Visit from external system; shift status computed locally |
| Match results | Scoring engine | Browser triggers POST → scoring pipeline runs → ranked candidates returned |
| Recommendation | Scoring + LLM | Browser triggers POST → scoring → reasoning → recommendation + match result returned |
| Roster tasks | Local database | Query with status/date filters, pagination |
| Roster analytics | Local database | Daily metrics aggregation with totals |
| Audit log | Local database | Searchable, filterable history |

### 4.2 Conversational Interface

Coordinators can query and act on rostering data through a chat interface that streams responses via Server-Sent Events (SSE).

**Read tools** (execute immediately, no confirmation required):

| Tool | Input | Output |
|------|-------|--------|
| `get_task_status` | task ID | Full task state: status, timings, assignment, escalation |
| `query_metrics` | metric name, day range | Fill rate, escalation count, average time-to-fill |
| `list_recent_tasks` | optional status filter, limit | Recent tasks with summary fields |
| `count_tasks_by_status` | — | Distribution: detected: N, scoring: M, escalated: K, … |

**Write tools** (require explicit coordinator confirmation):

| Tool | Input | Effect |
|------|-------|--------|
| `create_roster_task` | visit ID, optional urgency | Creates task in `detected` state; logs audit entry |
| `assign_caregiver` | task ID, employee ID | Manually assigns caregiver; sets `assigned` status; logs audit |
| `cancel_task` | task ID, reason | Cancels task (if not already terminal); logs audit with reason |

**Two-step confirmation flow for writes:**

```
Coordinator message
        │
        ▼
   LLM proposes write action
        │
        ▼
   SSE: { type: "confirmation_required", tool, args }
        │
   Coordinator confirms in UI
        │
        ▼
   Second POST with { confirmed_action: { tool, args } }
        │
        ▼
   Transaction executes write + audit log
        │
        ▼
   SSE: { type: "tool_result", result }
        │
        ▼
   Follow-up LLM call summarises outcome
```

All write operations use optimistic locking (version field) to prevent concurrent modification.

---

## 5. Data Flow: Webhook Event Processing by Type

| Event type | Handler action | Data written |
|------------|---------------|--------------|
| `visit.vacated` | Score + recommend replacement caregiver | Roster task (with match result + LLM recommendation) |
| `visit.created` | Initial scoring for new visit | Roster task |
| `visit.updated` | Re-evaluate if critical fields changed | Updated roster task (re-scored) |
| `visit.cancelled` | Cancel associated roster task | Roster task status → `cancelled` |
| `employee.status_changed` | Invalidate cached employee roster | Cache cleared; affected tasks re-evaluated |
| `employee.unavailability.created` | Invalidate cached employee roster | Cache cleared |
| `client.created` | Index new client for future scoring | Workflow event recorded |

Events that trigger scoring (`visit.vacated`, `visit.created`, `visit.updated`) pass through the debouncer. Employee lifecycle events invalidate the employee roster cache so the next scoring call fetches fresh data.

---

## 6. Data Caching Strategy

The platform uses a single cache layer with stampede prevention:

| Cached data | TTL | Invalidation trigger | Why it matters |
|-------------|-----|---------------------|---------------|
| Employee roster (all active employees + skills) | 30 s | `employee.status_changed`, `employee.unavailability` webhooks | Most expensive fetch; eliminates N+1 per-employee skills lookup during scoring |

**Stampede prevention.** When multiple scoring requests arrive concurrently (common during webhook bursts), only the first request fetches the roster from the care management system. All other callers receive a promise to the same in-flight fetch, then share the cached result.

**Debouncing.** Scoring-heavy webhook events are buffered for a configurable window (default 2 seconds). The first event in the batch warms the cache; subsequent events in the same batch hit the warm cache. Example: an employee departure triggers 20 `visit.vacated` events → 1 roster fetch instead of 20.

---

## 7. Cross-Cutting Data Patterns

### 7.1 Request Tracing

Every inbound request (user or webhook) is assigned a unique trace ID (UUID). This ID is:
- Threaded through authentication, handlers, service calls, and error responses.
- Stored on workflow event records.
- Included in structured log output.
- Returned in error payloads for support correlation.

### 7.2 Transaction Boundaries

The platform separates read and write transaction paths:

- **Write path (Unit of Work):** Opens a database transaction, injects the authenticated user's identity into the session context for row-level security, applies a 30-second statement timeout, and commits or rolls back atomically.
- **Read path (Read-Only Executor):** Same as the write path but additionally sets `READ ONLY` on the transaction, preventing accidental writes in query code.
- **External calls:** Scoring, LLM reasoning, and care management system API calls always run *outside* a transaction to avoid holding database connections during network I/O.

### 7.3 Optimistic Concurrency Control

Roster tasks carry a `version` integer. Every update includes a `WHERE version = N` clause. If no row is affected, a concurrent modification has occurred and the operation returns an error rather than silently overwriting. This prevents:
- Two cascade steps advancing the same task simultaneously.
- A chat-initiated manual assignment racing with an automated acceptance.

### 7.4 Data Pre-Fetching

The `MatchResult` object carries `fetchedVisit` and `fetchedClient` data alongside the scored candidates. Downstream consumers (LLM reasoning, recommendation context builder, webhook handlers) reuse these rather than re-fetching from the care management API. This pattern eliminates redundant network round-trips in the critical scoring → reasoning pipeline.

### 7.5 Structured Error Responses

All API errors return a consistent envelope:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human-readable description",
    "details": { },
    "traceId": "uuid"
  }
}
```

Error types map to HTTP status codes: validation errors → 400, authentication → 401, authorisation → 403, not found → 404, external service failures → 502.

### 7.6 Account Status Enforcement

The user status machine (`active → suspended → soft_deleted`) is enforced at the API boundary. Every authenticated request checks the user's status. Suspended or deleted accounts receive a 403 with a status code that the client intercepts to show a force-sign-out overlay. This ensures no data flows through the platform on behalf of a deactivated user.

---

## 8. Data Lifecycle Summary

| Data | Created by | Consumed by | Retention |
|------|-----------|-------------|-----------|
| Roster task | Webhook handler or chat tool | Orchestrator, dashboard, chat queries | Indefinite (local DB) |
| Match result | Scoring engine | LLM reasoning, roster task (JSON field), dashboard | Embedded in roster task |
| LLM recommendation | Reasoning service | Orchestrator (escalation decision), dashboard | Embedded in roster task |
| Contact attempt | Cascade engine | Orchestrator, acceptance scorer (feedback loop), audit log | Embedded in roster task |
| Audit log entry | Every state transition + chat action | Dashboard audit view, compliance | Append-only, indefinite |
| Daily metrics | Metrics service (on task resolution) | Dashboard analytics, chat `query_metrics` tool | Indefinite, one row per user per day |
| Workflow event | Webhook route | Idempotency check, debugging | Indefinite |
| User session | Login | Heartbeat, session list, device management | 30-day TTL |
| Chat message | User or assistant | Conversation history | Indefinite |
| Employee roster (cache) | Care management API | Scoring engine | 30-second TTL |

---

## 9. Data Integrity Guarantees

| Guarantee | Mechanism |
|-----------|-----------|
| No duplicate webhook processing | Two-layer idempotency (SELECT + unique constraint) |
| No concurrent task mutation | Optimistic locking (version field) |
| No accidental writes in read paths | Transaction-level `READ ONLY` enforcement |
| No orphaned data on failure | Database transactions with atomic commit/rollback |
| No stale employee data after status change | Cache invalidation on employee lifecycle webhooks |
| No unaudited state changes | Append-only audit log on every task transition |
| No unauthorised access | Row-level security with per-transaction identity injection |
| Consistent error traceability | Unique trace ID on every request, threaded end-to-end |

---

## 10. Conclusion

DappaAi's data flow is designed around three principles:

1. **Read from the source of truth.** Employee, visit, client, and skill data always come from the care management system. The platform stores only its own decision artefacts — tasks, scores, recommendations, audit entries, and metrics.

2. **Separate decisions from data access.** Hard constraints filter first, soft scoring ranks second, LLM reasoning recommends third. Each layer receives the output of the previous layer and adds its own judgement without re-fetching data.

3. **Leave a trail.** Every webhook event is recorded. Every state transition is audited. Every error carries a trace ID. The platform can reconstruct the full decision history for any shift-filling episode from detection through to assignment or escalation.

Together, these patterns enable autonomous shift filling while preserving the transparency and control that home care coordinators require.
