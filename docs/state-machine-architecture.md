# Roster Task State Machine Architecture

## Overview

The rostering state machine is the core workflow engine that drives autonomous shift filling. When a visit becomes vacant (a caregiver drops out), the system automatically detects the vacancy, scores eligible replacements, gets an LLM recommendation, contacts caregivers, and either fills the shift or escalates to a human coordinator.

The implementation lives in `src/services/rostering/` with the main orchestrator at `src/services/rostering/workflow-orchestrator.ts`.

## State Diagram

```
                         ┌──────────────────────────────────────────────────────────┐
                         │                    TERMINAL STATES                       │
                         │                                                          │
                         │   ┌──────────┐  ┌───────────┐  ┌───────────┐            │
                         │   │ assigned │  │ escalated │  │ cancelled │            │
                         │   └──────────┘  └───────────┘  └───────────┘            │
                         │        ▲              ▲              ▲                   │
                         │        │              │              │                   │
                         │   ┌────┴────┐         │         (human action)           │
                         │   │completed│         │                                  │
                         │   └─────────┘         │                                  │
                         └──────────────────────────────────────────────────────────┘
                                  ▲              │
                                  │              │
┌──────────┐  ┌───────────┐  ┌───┴────┐  ┌──────┴────┐  ┌────────────┐  ┌───────────┐  ┌──────────┐
│ detected │→ │ gathering │→ │scoring │→ │ reasoning │→ │ contacting │→ │ cascading │→ │ accepted │
└──────────┘  └───────────┘  └────────┘  └───────────┘  └────────────┘  └───────────┘  └──────────┘
                                  │            │              ▲               │              │
                                  │            │              │               │              │
                                  │            │              └───────────────┘              │
                                  │            │            (next candidate)                 │
                                  │            │                                             │
                                  ▼            ▼                                             ▼
                             escalated    escalated                                     completed
                             (no match)   (low confidence                            (write-back OK)
                             (thin bench)  / immediate                                     │
                                           escalation)                                     │
                                                                                           ▼
                                                                                       assigned
                                                                                    (write-back fail)
```

## States

### Active States

| Status | Description | Next States |
|--------|-------------|-------------|
| `detected` | Vacancy detected (webhook or polling). Task created. | `gathering` |
| `gathering` | Fetching visit and employee data from AlayaCare. | `scoring` |
| `scoring` | Running scoring engine + LLM reasoning pipeline. | `reasoning`, `escalated` |
| `reasoning` | LLM recommendation stored. Evaluating escalation triggers. | `contacting`, `escalated` |
| `contacting` | Waiting for current caregiver's response (SMS/email sent). | `cascading`, `contacting` (no expiry yet) |
| `cascading` | Current contact expired/declined. Deciding next action. | `contacting` (next candidate), `accepted`, `escalated` |
| `accepted` | Caregiver accepted. Writing assignment back to AlayaCare. | `completed`, `assigned` |

### Terminal States

| Status | Description | How Reached |
|--------|-------------|-------------|
| `assigned` | Assigned but AlayaCare write-back failed. Needs manual follow-up. | Write-back error in `accepted`, or human `take_over` action |
| `escalated` | Escalated to human coordinator. Awaiting human decision. | Thin bench, low LLM confidence, contact exhaustion, time threshold |
| `completed` | Shift filled. AlayaCare write-back succeeded. | Successful write-back from `accepted` |
| `cancelled` | Task cancelled (visit cancelled, or human cancellation). | Human `cancel` action |

## Transition Rules

Every transition is driven by `advanceTask()` in `workflow-orchestrator.ts`. The orchestrator uses a 3-phase pattern:

1. **Read** task state inside a UoW transaction
2. **Execute** external calls (AlayaCare API, Bedrock LLM) outside the transaction (avoids holding DB connections during network I/O)
3. **Persist** results inside a new UoW transaction with optimistic locking

### `detected` -> `gathering`

**Trigger**: `advanceTask()` called (via webhook event processing or polling).
**Logic**: Passthrough. No external calls.
**Data written**: None (status only).

### `gathering` -> `scoring`

**Trigger**: `advanceTask()` called.
**Logic**: Passthrough. Data gathering happens in the webhook handler (`handle-visit-vacated.ts`) which pre-populates `matchResult` before task creation.
**Data written**: None (status only).

### `scoring` -> `reasoning` | `escalated`

**Trigger**: `advanceTask()` calls `reasonAboutMatch()`.
**Logic**:
1. Check if `matchResult` exists with candidates. If no candidates -> **escalated**.
2. Check candidate count. If fewer than `MIN_VIABLE_CANDIDATES` (3) -> **escalated** (thin bench).
3. Call `buildRecommendationContext()` to fetch visit/client details.
4. Call `getRecommendation()` (Bedrock Haiku LLM).
5. If LLM call succeeds -> **reasoning** (stores full `LLMRecommendation` on task).
6. If LLM call fails -> **reasoning** (stores `LLMRecommendationError` fallback with top-scored candidate).

**Escalation reasons at this stage**:
- "No match result or eligible candidates"
- "Only N candidate(s) -- thin bench, needs human review"

**Data written**: `llmRecommendation` (full recommendation or error fallback), `scoringCompletedAt`.

### `reasoning` -> `contacting` | `escalated`

**Trigger**: `advanceTask()` calls `initiateContact()`.
**Logic**: Evaluates the stored LLM recommendation:
1. If no recommendation or error fallback -> **contacting** (proceed with scoring-only ranking).
2. If `escalation.should_escalate` AND `escalation.urgency === "immediate"` -> **escalated**.
3. If `primary.confidence === "low"` -> **escalated** (low confidence on all candidates).
4. Otherwise -> **contacting** (proceed normally; `before_shift` and `informational` escalation levels are logged but don't block).

**Escalation reasons at this stage**:
- LLM escalation reason (from recommendation)
- "LLM confidence is low on all candidates -- needs human review"

**Data written**: `firstContactAt` (first time entering contacting).

### `contacting` -> `cascading` | `contacting`

**Trigger**: `advanceTask()` calls `handleContacting()`.
**Logic**:
1. `checkAndExpireContacts()` checks if the current contact's `expires_at` has passed.
2. If not expired -> **contacting** (stays put; polling will re-check).
3. If expired -> mark contact as `expired`, transition to **cascading**.

**Data written**: Updated `contacts` array (expired contact marked).

### `cascading` -> `contacting` | `accepted` | `escalated`

**Trigger**: `advanceTask()` calls `handleCascading()`.
**Logic**:
1. Check `shouldEscalate()` against urgency config thresholds. If threshold reached -> **escalated**.
2. If cascade strategy is `parallel`:
   - `advanceParallelCascade()`: first accept wins -> **accepted** (other pending contacts cancelled).
   - All resolved with no accept -> **escalated**.
   - Still pending responses -> stays in **cascading**.
3. If cascade strategy is `sequential`:
   - `advanceSequentialCascade()`: find next pending contact -> **contacting** (with incremented index).
   - All contacts exhausted -> **escalated**.

**Escalation reasons at this stage**:
- "Cascade exhausted -- escalation threshold reached"
- "All parallel contacts exhausted"
- "All sequential contacts exhausted"

**Data written**: `currentContactIndex`, `assignedEmployeeId`, updated `contacts` (cancelled contacts).

### `accepted` -> `completed` | `assigned`

**Trigger**: `advanceTask()` calls `handleAccepted()`.
**Logic**:
1. Verify `assignedEmployeeId` exists. If missing -> **escalated**.
2. POST to AlayaCare API (`/scheduler/visits/{visitId}/offers`) to assign the employee.
3. If API call succeeds -> **completed**.
4. If API call fails -> **assigned** (manual follow-up needed).

**Data written**: `resolvedAt`, `timeToFillMs`, `escalationReason` (if write-back failed).

## Escalation Paths

Tasks can escalate at four different points:

| Stage | Condition | Reason |
|-------|-----------|--------|
| `scoring` | Zero candidates | No eligible employees available |
| `scoring` | < 3 candidates | Thin bench -- insufficient options for reliable match |
| `reasoning` | LLM says `should_escalate` + `immediate` urgency | Clinical risk, regulatory concern, or other critical factor |
| `reasoning` | LLM `primary.confidence === "low"` | No confident recommendation possible |
| `cascading` | Contact-count threshold reached (sequential) | N contacts exhausted without acceptance |
| `cascading` | Time threshold reached (parallel) | N minutes elapsed since first contact |
| `cascading` | All contacts resolved, none accepted | Every candidate declined or expired |
| `accepted` | No `assignedEmployeeId` on task | Data integrity issue |

## Human Actions (on Escalated Tasks)

Once a task reaches `escalated`, a human coordinator can take action via the `handle-human-action` handler. Only escalated tasks accept human actions.

| Action | Effect | Next Status |
|--------|--------|-------------|
| `accept_recommendation` | Trust the system's recommendation, resume contact cascade | `contacting` |
| `assign_manually` | Directly assign a specific employee (requires `employee_id`) | `accepted` |
| `defer` | Acknowledge but take no action (audit-only, no state change) | `escalated` |
| `take_over` | Coordinator takes personal responsibility | `assigned` |
| `cancel` | Cancel the task entirely (requires `reason`) | `cancelled` |

**Validation rules**:
- `assign_manually` requires `employee_id`
- `cancel` requires a non-empty `reason`

## Urgency Configuration

Urgency determines the cascade strategy, contact timeouts, and escalation thresholds. Configuration is defined in `src/services/rostering/urgency-classifier.ts`.

### Classification Logic

```typescript
function classifyUrgency(visit): "planned" | "urgent" {
  if (hoursUntilShift < 4) return "urgent";
  if (visit.service_instructions?.includes("URGENT")) return "urgent";
  return "planned";
}
```

### Configuration Presets

| Parameter | Planned | Urgent |
|-----------|---------|--------|
| **Weight preset** | `planned` | `urgent` |
| **Cascade strategy** | `sequential` | `parallel` |
| **Contact expiry** | 120 minutes | 20 minutes |
| **Escalation threshold** | 10 contacts exhausted | 15 minutes elapsed |
| **Escalation type** | `contacts` (count-based) | `time` (time-based) |

### Cascade Strategy Details

**Sequential** (planned shifts):
- Contact candidates one-by-one in score-ranked order
- Wait for response or expiry before moving to next candidate
- Escalate when 10 contacts have been exhausted (declined or expired)
- Preserves candidate ranking -- higher-ranked candidates get first opportunity

**Parallel** (urgent shifts):
- Contact all top candidates simultaneously
- First acceptance wins; all other pending contacts are cancelled
- Escalate after 15 minutes if no acceptance
- Maximises speed for time-critical vacancies

### Customising Urgency

To add a new urgency level or adjust thresholds:

1. Add the new level to `URGENCY_LEVELS` in `src/services/rostering/types.ts`
2. Add the corresponding config to `getUrgencyConfig()` in `src/services/rostering/urgency-classifier.ts`
3. Update `classifyUrgency()` detection logic
4. Add a matching weight preset in `src/services/scoring/weights.ts`

The `UrgencyConfig` interface:

```typescript
interface UrgencyConfig {
  weightPreset: string;                     // Scoring weight preset name
  cascadeStrategy: "sequential" | "parallel";
  expiryMinutes: number;                    // Per-contact timeout
  escalationThreshold:
    | { type: "time"; minutes: number }     // Time since first contact
    | { type: "contacts"; count: number };  // Count of exhausted contacts
}
```

## Data Validation

Before scoring runs, `validateMatchInputs()` in `data-validator.ts` checks data quality:

**Blockers** (prevent scoring):
- Visit not found
- No client associated with visit
- No eligible employees found

**Warnings** (logged but don't block):
- Visit start time is in the past
- Visit missing GPS coordinates (distance scoring skipped)
- Fewer than 3 active employees (limited candidate pool)

## Concurrency & Safety

### Optimistic Locking

Every task has a `version` integer column. Updates use a WHERE clause:

```sql
UPDATE roster_tasks SET ..., version = version + 1
WHERE id = $1 AND user_id = $2 AND version = $3
```

If the version doesn't match (concurrent modification), a `ConflictError` (409) is thrown. Callers should retry with fresh data.

### TOCTOU Prevention

The 3-phase orchestrator pattern guards against time-of-check-to-time-of-use races:

1. Phase 1: Read task state (UoW #1)
2. Phase 2: Run external calls (no DB connection held)
3. Phase 3: Re-read task with fresh version check (UoW #2)

Between Phase 1 and Phase 3, another process could have moved the task to a terminal state. The fresh read in Phase 3 catches this:

```typescript
if (TERMINAL_STATUSES.has(freshTask.status)) {
  return freshTask; // Skip persist -- task already resolved
}
```

### External Calls Outside Transaction

All network I/O (AlayaCare API, Bedrock LLM) runs **outside** the UoW transaction. This prevents:
- DB connection pool exhaustion during slow API calls
- Long-held transactions blocking other operations
- Transaction timeout failures on multi-second LLM calls

## Triggering the State Machine

### 1. Webhook Events (Primary Path)

The `visit.vacated` webhook event triggers the most common path:

```
AlayaCare webhook
  -> POST /api/v1/webhooks/alayacare
  -> dispatcher routes to handle-visit-vacated
  -> computeMatch() + getRecommendation()
  -> Stores result in workflow_events table
  -> process-pending-events creates RosterTask with pre-computed matchResult
  -> advanceTask() drives through state machine
```

The debouncer (`WebhookDebouncer`) buffers scoring-heavy events for ~2 seconds to batch burst events.

### 2. Event Processing (Batch)

`process-pending-events.ts` is a batch processor that:

1. Finds unprocessed `workflow_events` with completed results (bounded to 50)
2. Creates `RosterTask` records in a single UoW transaction
3. Advances all tasks concurrently via `Promise.allSettled()` (each task opens its own UoW)
4. Failures are logged but don't block other tasks

Tasks created from events with pre-computed `matchResult` start at `reasoning` status (skipping `detected` -> `gathering` -> `scoring`).

### 3. Chat Tools (Manual)

Users can create tasks via the conversational interface:

```
create_roster_task tool
  -> createRosterTask() at "detected" status
  -> advanceTask() drives through state machine
```

### 4. Polling Fallback

`trigger-detector.ts` provides a safety net:
- Fetches recent vacant visits from AlayaCare
- Compares against active roster tasks
- Creates tasks for untracked vacancies

## Audit Trail

Every state transition is recorded in the `roster_audit_log` table via `appendAudit()`:

```typescript
{
  action: "scoring_to_reasoning",     // Format: {from}_to_{to}
  actor: "system",                     // "system", "llm", or user UUID
  details: {
    previousStatus: "scoring",
    newStatus: "reasoning",
  },
}
```

Human actions are recorded as `human_{action}` (e.g., `human_accept_recommendation`, `human_cancel`).

## Timestamps & Metrics

The state machine automatically records timing data:

| Field | Set When |
|-------|----------|
| `detectedAt` | Task creation (default) |
| `scoringCompletedAt` | `scoring` -> `reasoning` transition |
| `firstContactAt` | First entry into `contacting` (preserved across re-entries) |
| `resolvedAt` | Entry into any terminal state (`completed`, `assigned`, `escalated`, `cancelled`) |
| `timeToFillMs` | Calculated at resolution: `resolvedAt - detectedAt` |

These feed into `metrics-service.ts` which materialises daily aggregations (tasks created, filled autonomously, escalated, average time-to-fill, first-contact acceptance rate).

## Key Files Reference

| File | Purpose |
|------|---------|
| `src/services/rostering/types.ts` | Status enums, type definitions, Zod schemas |
| `src/services/rostering/workflow-orchestrator.ts` | Main `advanceTask()` pipeline and step logic |
| `src/services/rostering/roster-task-service.ts` | CRUD operations with optimistic locking |
| `src/services/rostering/cascade-engine.ts` | Sequential + parallel cascade logic, escalation triggers |
| `src/services/rostering/urgency-classifier.ts` | Urgency detection + config presets |
| `src/services/rostering/data-validator.ts` | Pre-flight data quality checks |
| `src/services/rostering/audit-service.ts` | Append-only audit trail |
| `src/services/rostering/metrics-service.ts` | Daily metrics materialisation |
| `src/services/rostering/communication/` | SMS/email provider abstraction (mock stubs) |
| `src/server/commands/roster/handle-human-action.ts` | Human intervention on escalated tasks |
| `src/server/commands/roster/process-pending-events.ts` | Batch event-to-task processor |
| `src/server/commands/webhooks/handle-visit-vacated.ts` | Webhook handler (scoring + LLM trigger) |

## Database Schema

### `roster_tasks` (27 columns)

Key columns for state machine operation:

- `status` -- current state (one of 11 values)
- `urgency` -- `planned` or `urgent`
- `version` -- optimistic locking counter
- `matchResult` -- JSONB, scoring engine output
- `llmRecommendation` -- JSONB, LLM reasoning output
- `contacts` -- JSONB array of `ContactAttempt` objects
- `currentContactIndex` -- position in sequential cascade
- `cascadeStrategy` -- `sequential` or `parallel`
- `assignedEmployeeId` -- employee who accepted
- `escalatedTo` -- user who took over (human action)
- `escalationReason` -- why the task was escalated
- `sourceEventId` -- correlation to webhook event (idempotency)

### `roster_audit_log` (append-only)

- `taskId` -- FK with cascade delete
- `action` -- transition or human action name
- `actor` -- `"system"` or user UUID
- `details` -- JSONB context
- `reasoning` -- optional LLM reasoning text

### `roster_daily_metrics` (idempotent upsert)

- `tasksCreated`, `tasksFilledAutonomous`, `tasksEscalated`
- `avgTimeToFillMs`, `firstContactAcceptanceRate`
- Composite unique on `(userId, date)`
