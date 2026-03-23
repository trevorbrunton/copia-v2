# System Design Review — 2026-03-13

Adversarial review of the Mayfly/DappaAi system. Assumes every component will
eventually fail, every network call will eventually timeout, and every user will
eventually do something unexpected.

**Scope**: Full-stack review of the Next.js application including API routes,
database access, external integrations, state machine, and scoring engine.

---

## Summary

| Severity | Count | Areas |
|----------|-------|-------|
| **Critical** | 3 | Dev endpoint unguarded, RLS not enforced, webhook double-dispatch |
| **High** | 6 | No timeouts on external calls, no connection pool config, missing state machine validation, cascade JSONB race, AlayaCare proxy authz, orphaned task recovery |
| **Medium** | 7 | N+1 skills fetch, missing rate limiting, env var validation at startup, chat write idempotency, audit failure silent, error detail leakage, dev simulate-response guarding |
| **Low** | 3 | Session heartbeat silent, login history unbounded, API versioning |

**Bottom line**: The layered architecture is well-designed and the separation of
concerns is genuinely good. But the system has three critical issues that must be
fixed before any production deployment, and several high-severity gaps that will
cause real failures under load or concurrent access.

---

## 1. Failure Modes

### CRITICAL-01: Dev Reset Endpoint Has No Environment Guard

**Scenario**: The `/api/v1/dev/reset` route truncates `roster_tasks`,
`roster_daily_metrics`, and `workflow_events`. Unlike `/api/v1/dev/simulate-response`
(which checks `NODE_ENV !== "production"`), the reset endpoint has **no environment
guard whatsoever**. Any authenticated user can wipe all rostering data in production.

```
app/api/v1/dev/reset/route.ts — lines 15-42

POST /api/v1/dev/reset
  → requireAuthContext() ← auth only, no role check
  → db.transaction(async (tx) => {
      await tx.delete(rosterDailyMetrics);   // all rows
      await tx.delete(rosterTasks);          // all rows (+ audit via cascade)
      await tx.delete(workflowEvents);       // all rows
    })
```

- **Impact**: Complete data loss of all rostering state, audit history, and
  workflow events. Unrecoverable without database backup.
- **Severity**: **Critical**
- **Fix**: Add the same guard as `simulate-response`:
  ```typescript
  if (process.env.NODE_ENV === "production") {
    return new Response(null, { status: 404 });
  }
  ```
  Better: delete both dev endpoints from the production build entirely, or gate
  behind an admin role check.

---

### CRITICAL-02: Webhook Idempotency Race — Handler Executes Twice

**Scenario**: Two identical webhook deliveries arrive within milliseconds (common
with webhook retry logic). The SELECT-then-INSERT idempotency check is not atomic.

```
app/api/v1/webhooks/alayacare/route.ts — lines 67-89

Request A                         Request B
─────────                         ─────────
SELECT → 0 rows (passes)
                                  SELECT → 0 rows (passes)
INSERT → succeeds
                                  INSERT → unique constraint → caught → returns "already_processed"
dispatch(event) → runs handler
                                  ← returns before dispatch
```

Wait — the current code actually handles this correctly for the INSERT race. But
there's a subtler issue: if the INSERT in Request B succeeds (clock skew, different
event_id serialisation), **both requests dispatch**. More importantly, the code
catches the unique constraint error and returns early (line 79-81), so the second
request does NOT dispatch.

**Revised assessment**: The two-layer idempotency (SELECT + INSERT unique constraint
catch) is correctly implemented for the INSERT race. However, the real risk is:

**The dispatch itself is not idempotent.** If the handler (`handleVisitVacated`)
succeeds but `updateEventStatus("completed")` fails (line 97), the event stays
in "received" status. On retry, the SELECT check passes (event exists), so it
returns "already_processed" — but the original handler result was never recorded.

Worse: if the server crashes between `dispatch()` (line 89) and
`updateEventStatus()` (line 97), the event is "received" forever and the external
side effects (scoring, LLM calls) already happened but are not recorded.

```
Timeline:
1. INSERT → status = "received"     ← committed
2. dispatch(event) → handler runs   ← scoring + LLM calls fire
3. ← SERVER CRASH ←
4. updateEventStatus("completed")   ← never runs
5. Event stuck in "received" status forever
6. No retry mechanism exists
```

- **Impact**: Lost event completion records. External side effects (scoring, LLM
  calls to Bedrock) already fired but not tracked. Manual intervention required
  to reconcile.
- **Severity**: **Critical** (for production webhook reliability)
- **Fix**: Wrap the dispatch + status update in a single transaction. If using
  external calls that can't be rolled back, record a "processing" status before
  dispatch, then update to "completed"/"failed" after. Add a reconciliation job
  that scans for events stuck in "processing" > 5 minutes.

---

### HIGH-01: No Timeouts on AlayaCare API Calls

**Scenario**: The AlayaCare API (or mock-alaya) becomes unresponsive. Every
`alayaFetch()` call hangs indefinitely because `fetch()` has no default timeout.

```
src/lib/alayacare-client.ts — line 62

const res = await fetch(url, {
  method,
  headers,
  body: body ? JSON.stringify(body) : undefined,
  cache: "no-store",
  // ← NO signal, NO timeout
});
```

During match scoring, `computeMatch()` makes 1 + N parallel calls (line 165-170
in `compute-match.ts`). If the API hangs:

- 150 parallel `fetch()` calls all hang
- Next.js serverless function hits its 30s timeout
- User sees generic 504
- Connection pool fills with waiting connections
- Cascading: other requests queue behind exhausted connections

- **Impact**: Complete scoring pipeline unavailability. Cascading to all API
  routes sharing the connection pool.
- **Severity**: **High**
- **Fix**:
  ```typescript
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    // ...
  } finally {
    clearTimeout(timeout);
  }
  ```

---

### HIGH-02: No Database Connection Pool Configuration

**Scenario**: Under concurrent load, the default postgres-js pool (max 25
connections, no idle timeout) becomes exhausted.

```
src/db/index.ts — line 7

const client = postgres(connectionString, { prepare: false });
// ← No max, no idle_timeout, no connect_timeout
```

Each request uses 1-3 connections (auth resolution + UoW/ReadOnly). At 10
concurrent requests = 10-30 connections. At 15+ concurrent requests, new requests
queue indefinitely waiting for a free connection.

- **Impact**: Request latency spikes, then timeouts cascade across all routes.
- **Severity**: **High**
- **Fix**:
  ```typescript
  const client = postgres(connectionString, {
    prepare: false,
    max: 50,
    idle_timeout: 30,
    connect_timeout: 5,
  });
  ```

---

### HIGH-03: Roster State Machine Allows Illegal Transitions

**Scenario**: A bug in a step handler returns an incorrect `nextStatus`. The
`updateRosterTask` function checks `version` (optimistic locking) but never
validates that the transition is legal.

```
src/services/rostering/roster-task-service.ts — updateRosterTask()

// Validates: version matches (optimistic lock)
// Does NOT validate: current.status → nextStatus is a legal transition
```

Example: a handler bug could transition a task from `completed` → `contacting`,
which violates the state machine contract. The optimistic lock would pass (version
matches), and the illegal state would be persisted silently.

- **Impact**: State machine corruption. Downstream code (cascade engine,
  escalation engine, AlayaCare writeback) receives tasks in impossible states.
  Audit trail records impossible transitions.
- **Severity**: **High**
- **Fix**: Add a transition validation map:
  ```typescript
  const LEGAL_TRANSITIONS: Record<RosterTaskStatus, RosterTaskStatus[]> = {
    detected: ["gathering"],
    gathering: ["scoring", "escalated"],
    scoring: ["reasoning", "escalated"],
    // ...
  };
  ```
  Check before every `updateRosterTask` call.

---

### HIGH-04: Cascade Engine — Concurrent Contact Responses Race on JSONB

**Scenario**: In parallel cascade mode (urgent shifts), multiple employees
respond to SMS offers simultaneously. Their responses are stored in a `contacts`
JSONB array on the `rosterTasks` row. Two concurrent UoW transactions attempt to
update the same JSONB array.

```
Timeline (parallel cascade, 3 contacts sent):
1. Employee A accepts (SMS webhook → UoW reads task version=1)
2. Employee B accepts (SMS webhook → UoW reads task version=1)
3. Employee A's UoW: UPDATE contacts[0].response="accepted", version=2 → succeeds
4. Employee B's UoW: UPDATE contacts[1].response="accepted", version=2 → ConflictError
5. Employee B's response is LOST
```

The optimistic lock correctly prevents corruption, but Employee B's valid
acceptance response is silently dropped. No retry mechanism re-reads the task
and re-applies the response.

- **Impact**: Employee receives acceptance confirmation but their response is
  not recorded. Task may be assigned to Employee A when Employee B was also
  available (or preferred).
- **Severity**: **High**
- **Fix**: Either (a) split contacts into a separate `roster_contacts` table
  with row-level locking, or (b) implement retry-on-conflict logic that re-reads
  the task and re-applies the response (max 3 retries with backoff).

---

### HIGH-05: AlayaCare Proxy Routes Have No Authorization

**Scenario**: Authenticated User A calls `GET /api/v1/alaya-clients` and receives
ALL clients, not just their own. The proxy routes check authentication
(`requireAuthContext`) but perform no authorization.

```
app/api/v1/alaya-clients/route.ts
app/api/v1/employees/route.ts
app/api/v1/visits/route.ts

Pattern:
  await requireAuthContext(request, traceId);  // ← auth only
  const data = await alayaFetch(...)           // ← returns all data
  return NextResponse.json(data);              // ← no filtering
```

Every authenticated user sees the same AlayaCare data regardless of role or
organisational scope.

- **Impact**: In a multi-tenant scenario, data leak across tenants. In a
  single-tenant PoC, acceptable — but must be addressed before multi-org
  deployment.
- **Severity**: **High** (for production), **Medium** (for single-tenant PoC)
- **Fix**: Add role-based access control. At minimum, scope AlayaCare queries
  by the user's organisation/team. Consider implementing the existing policy
  layer (currently noop) for these routes.

---

### HIGH-06: Orphaned Roster Tasks After Crash During Advancement

**Scenario**: `process-pending-events.ts` creates N tasks in one UoW, then
advances them concurrently with `Promise.allSettled()`. If the server crashes
during advancement, tasks are stuck in `detected` status with no automatic
recovery.

```
src/server/commands/roster/process-pending-events.ts

Phase 1: UoW creates tasks → committed
Phase 2: Promise.allSettled(tasks.map(advanceTask)) → IN PROGRESS
  ← crash / timeout ←
Phase 2 result: some tasks never advanced
```

No reconciliation job exists to detect and retry orphaned tasks.

- **Impact**: Shifts go unfilled because tasks are stuck. Manual intervention
  required (no dashboard for orphaned tasks).
- **Severity**: **High**
- **Fix**: Add a periodic reconciliation query:
  ```sql
  SELECT * FROM roster_tasks
  WHERE status = 'detected'
  AND created_at < NOW() - INTERVAL '5 minutes';
  ```
  Re-advance these tasks automatically. Log at WARN level.

---

## 2. Data Integrity

### MEDIUM-01: Chat Write Tools Lack Idempotency Key

**Scenario**: Client sends a write confirmation (`confirmed_action`), the UoW
commits (e.g., task created), but the SSE response is lost due to network drop.
Client retries the same confirmation. No idempotency key prevents duplicate
execution.

```
app/api/v1/chat/stream/route.ts — write confirmation flow

1. Client: POST { confirmed_action: "create_roster_task", ... }
2. Server: UoW commits → task created
3. Server: SSE sends tool_result
4. ← NETWORK DROP ←
5. Client: retries same POST → UoW commits → DUPLICATE task created
```

- **Impact**: Duplicate roster tasks, duplicate contact attempts.
- **Severity**: **Medium**
- **Fix**: Add a `confirmation_id` (UUID) to each write confirmation. Store it
  on the created entity. Check for existence before executing.

---

### MEDIUM-02: No Unique Constraint on `(visitId, sourceEventId)` in roster_tasks

**Scenario**: Two webhook events for the same visit (e.g., rapid re-delivery)
each create a roster task. The idempotency check is on `workflow_events.event_id`,
not on the resulting task.

- **Impact**: Duplicate tasks for the same visit. Duplicate scoring, LLM calls,
  and contact attempts.
- **Severity**: **Medium**
- **Fix**: Add a unique constraint:
  ```sql
  ALTER TABLE roster_tasks
  ADD CONSTRAINT uq_roster_visit_source
  UNIQUE (visit_id, source_event_id);
  ```

---

### MEDIUM-03: Audit Write Failures Silently Swallowed

**Scenario**: In the webhook route, if `updateEventStatus("failed")` fails, the
error is caught and discarded:

```
app/api/v1/webhooks/alayacare/route.ts — line 92

await updateEventStatus(event.event_id, "failed").catch(() => {});
```

- **Impact**: No audit trail for failed events. Compliance gap.
- **Severity**: **Medium**
- **Fix**: Log the error at ERROR level inside the catch. Don't swallow silently.

---

## 3. Performance & Scalability

### MEDIUM-04: N+1 API Calls in Skills Fetching (Scoring Hot Path)

**Scenario**: `computeMatch()` fetches skills individually for each
schedule-eligible employee. With 150 active employees, this is 150 parallel
HTTP calls to AlayaCare.

```
src/services/scoring/compute-match.ts — lines 165-170

const skillsResults = await Promise.all(
  scheduleEligible.map((emp) =>
    alayaFetch(`/employees/employees/${emp.id}/skills`)
  )
);
```

**Latency impact**:
```
Phase 1 (bulk fetch, 5 parallel):     ~100ms
Phase 2a (schedule filter, in-memory): ~5ms
Phase 2b (skills fetch, 150 parallel): ~500-800ms  ← BOTTLENECK
Phase 2c (skills filter, in-memory):   ~5ms
Phase 3 (scoring, in-memory):          ~50ms
Phase 4 (ranking):                     ~5ms
─────────────────────────────────────────────
Total match scoring:                   ~665-965ms
+ LLM recommendation:                 ~800-1500ms
─────────────────────────────────────────────
Total recommendation pipeline:         ~1,465-2,465ms
```

The 150 parallel calls also risk hitting AlayaCare rate limits and exhausting
the Node.js connection pool.

- **Impact**: Scoring latency directly proportional to employee count. At 300+
  employees, the pipeline exceeds 2s. Rate limiting may cause intermittent
  failures.
- **Severity**: **Medium** (acceptable for PoC with mock-alaya, problematic for
  production AlayaCare)
- **Fix**: Investigate AlayaCare batch skills endpoint. If unavailable, implement
  a server-side cache (TTL 1 hour, invalidated on employee webhook events). This
  would reduce Phase 2b from ~800ms to ~0ms for cached employees.

---

### MEDIUM-05: No Rate Limiting on Expensive Endpoints

**Scenario**: A user (or attacker) rapidly calls `/api/v1/visits/[id]/recommend`
50 times. Each call triggers scoring (150 API calls) + LLM inference (~$0.02/call).

```
50 rapid calls:
  - 50 × 150 = 7,500 AlayaCare API calls
  - 50 × ~10K tokens = 500K LLM tokens (~$0.80)
  - Connection pool exhaustion likely
  - AlayaCare rate limit hit likely
```

- **Impact**: Cost spike, service degradation for other users, potential
  AlayaCare API ban.
- **Severity**: **Medium**
- **Fix**: Add per-user rate limiting (10 req/min) on `/match`, `/recommend`,
  and `/availability` endpoints.

---

## 4. Security

### CRITICAL-03: RLS Not Enforced — Connected as `postgres` (BYPASSRLS)

**Scenario**: The database connection uses the `postgres` role which has
`BYPASSRLS`. All Row-Level Security policies are defined (migration 009) but
**completely unenforced**. Tenant isolation relies entirely on service-layer
`eq(userId)` WHERE clauses.

```
src/db/index.ts — line 7

const client = postgres(connectionString, { prepare: false });
// connectionString uses postgres role → BYPASSRLS
```

If any service function omits the `eq(userId)` clause (or a new route is added
without it), all users' data is accessible. The `getOrCreateUser` function
(`src/lib/auth.ts`) intentionally bypasses RLS (documented as D3 exception), but
ALL other queries also bypass it unintentionally.

Migration 010 creates the `mayfly_app` role (non-BYPASSRLS) but it has not been
applied to the connection string.

- **Impact**: No database-level tenant isolation. A single missing WHERE clause
  = data leak.
- **Severity**: **Critical** (for production)
- **Fix**: Switch `DATABASE_URL` to use the `mayfly_app` role. Keep a separate
  `DATABASE_ADMIN_URL` for `getOrCreateUser` and migrations. Test thoroughly —
  the UoW already sets `request.jwt.claims` which `auth.uid()` reads, so RLS
  policies should work.

---

### MEDIUM-06: Dev Reset Endpoint Allows Any Authenticated User to Truncate Data

(Covered in CRITICAL-01 above — listed here as security cross-reference.)

The reset endpoint performs no role check. Any authenticated user (not just
admins) can truncate production data.

---

### MEDIUM-07: Error Responses Leak Validation Schema Details

**Scenario**: Zod validation errors return the full `issues` array to the client,
including field names and validation rules.

```
src/server/errors.ts — handleAppError()

return Response.json({
  error: {
    code: "VALIDATION_ERROR",
    message: issues[0]?.message || "Validation failed",
    details: issues,  // ← full schema detail exposed
    ...(traceId && { traceId }),
  },
}, { status: 400 });
```

- **Impact**: Attackers learn the exact schema of every endpoint. Low severity
  but violates defense-in-depth.
- **Severity**: **Medium**
- **Fix**: In production, return only `message` without `details`. Keep `details`
  in development mode.

---

### MEDIUM-08: Environment Variables Validated at Request Time, Not Startup

**Scenario**: Server boots with missing `ALAYACARE_WEBHOOK_SECRET`. First
webhook returns 500. Operator doesn't know until the first event arrives
(potentially hours later).

Missing env vars that fail at request time:
- `ALAYACARE_PUBLIC_KEY` / `ALAYACARE_PRIVATE_KEY` — first AlayaCare call
- `ALAYACARE_WEBHOOK_SECRET` — first webhook
- `DATABASE_URL` — first query (though likely caught by postgres-js)

- **Impact**: Silent misconfiguration. Failures are delayed and hard to diagnose.
- **Severity**: **Medium**
- **Fix**: Add a startup validation module. In Next.js, use
  `instrumentation.ts` (register hook) to validate all required env vars at boot.

---

## 5. Operational Risk

### Observability Gaps

**What's good**:
- Structured logger with JSON output in production
- `traceId` threaded through all requests via `AuthContext`
- UoW lifecycle logged at debug level
- Error envelope includes `traceId` for correlation

**What's missing**:
- **No latency instrumentation** in the scoring pipeline. If scoring slows
  from 1s to 5s, there's no metric or alert to detect it. Must add phase timing
  logs to `computeMatch()`.
- **No LLM inference latency tracking**. Bedrock latency spikes won't be
  detected until users complain.
- **No webhook processing time tracking**. Can't tell if `handleVisitVacated`
  is taking 100ms or 10s.
- **No connection pool metrics**. Can't detect pool exhaustion before it
  cascades.

### Deployment Risk

**Rollback safety**: Standard Next.js deployment. No database migrations run
automatically, so rollback is safe as long as migrations are backwards-compatible.

**Downtime risk**: The dev reset endpoint (CRITICAL-01) could cause unintended
data loss during deployment if hit accidentally.

**Migration risk**: Migration 010 (`mayfly_app` role) is a DO block that must
be run in Supabase SQL Editor — cannot be run via the `run-migration.ts` script
(which splits on `;`). This is documented but creates a manual step that could
be forgotten.

### External Dependencies

| Dependency | Failure Mode | Current Handling | Gap |
|------------|-------------|------------------|-----|
| AlayaCare API | Timeout/5xx | `ExternalServiceError` (502) | No timeout on fetch, no retry, no circuit breaker |
| Supabase Auth | Timeout/5xx | 401 to client | No fallback, no cached sessions |
| AWS Bedrock (Haiku) | Timeout/5xx | Fallback recommendation object | Fallback not audited, not surfaced in UI |
| Supabase PostgreSQL | Timeout/connection | Drizzle error propagation | No connection pool config, no health check |

---

## Action Plan

### Must Fix Before Production (Critical)

| # | Issue | Effort | Owner |
|---|-------|--------|-------|
| CRITICAL-01 | Add env guard to dev/reset endpoint | 30 min | |
| CRITICAL-02 | Add "processing" status to webhook flow + reconciliation | 4 hrs | |
| CRITICAL-03 | Switch DATABASE_URL to mayfly_app role | 2 hrs | |

### Fix This Sprint (High)

| # | Issue | Effort | Owner |
|---|-------|--------|-------|
| HIGH-01 | Add 5s timeout to alayaFetch | 1 hr | |
| HIGH-02 | Configure connection pool (max, idle_timeout) | 30 min | |
| HIGH-03 | Add state transition validation map | 2 hrs | |
| HIGH-04 | Add retry-on-conflict for contact responses | 4 hrs | |
| HIGH-05 | Add authorization to AlayaCare proxy routes | 4 hrs | |
| HIGH-06 | Add orphaned task reconciliation query | 2 hrs | |

### Fix Next Sprint (Medium)

| # | Issue | Effort | Owner |
|---|-------|--------|-------|
| MEDIUM-01 | Add confirmation_id to chat write tools | 2 hrs | |
| MEDIUM-02 | Add unique constraint on (visitId, sourceEventId) | 1 hr | |
| MEDIUM-03 | Log audit write failures instead of swallowing | 30 min | |
| MEDIUM-04 | Investigate AlayaCare batch skills API or add cache | 4 hrs | |
| MEDIUM-05 | Add rate limiting to expensive endpoints | 4 hrs | |
| MEDIUM-06 | (Covered by CRITICAL-01) | — | |
| MEDIUM-07 | Strip error details in production | 1 hr | |
| MEDIUM-08 | Add startup env var validation | 2 hrs | |

---

## What's Actually Good

This review is intentionally adversarial, so it's worth noting what's done well:

1. **Layered architecture** is genuinely clean. Transport → Handler → Service
   separation is consistent and well-enforced.
2. **UoW pattern** with `SET LOCAL request.jwt.claims` is a clever way to make
   RLS work with a shared connection pool. Once the role is switched from
   `postgres` to `mayfly_app`, this will provide real tenant isolation.
3. **Optimistic locking** on roster tasks prevents most concurrent modification
   issues (the JSONB contact race is the main gap).
4. **Webhook idempotency** with two-layer check (SELECT + INSERT unique
   constraint catch) is correctly implemented for the common case.
5. **Scoring pipeline prefetch** — `fetchedVisit`/`fetchedClient` on `MatchResult`
   eliminates double-fetching between scoring and recommendation. This is a good
   design decision.
6. **Statement timeout** (30s) on all UoW/ReadOnly operations prevents runaway
   queries.
7. **Structured logging** with `traceId` correlation is production-ready.
8. **Error hierarchy** (`AppError` → `NotFoundError`, `ConflictError`,
   `ExternalServiceError`) maps cleanly to HTTP status codes.

The system is well-architected. The issues found are primarily around operational
hardening (timeouts, pool config, rate limiting) and a few missing guards that
are typical of a PoC-to-production transition.
