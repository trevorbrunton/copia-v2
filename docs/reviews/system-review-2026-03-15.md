# System Review — Upstash + Xano Architecture

**Date**: 2026-03-15
**Target**: `docs/upstash-xano-architecture.md`
**Methodology**: Adversarial failure analysis — assume every component fails, every network call times out, every concurrent request races.
**Resolution**: Findings addressed in implementation spec (`upstash-xano-implementation-spec.md`) and deferred items in production hardening backlog (`production-hardening-backlog.md`).

---

## Summary

| Severity | Count | Resolved |
|----------|-------|----------|
| Critical | 3 | 3 |
| High | 5 | 5 |
| Medium | 5 | 5 |
| Low | 3 | 3 |

---

## Critical Issues

### C1 — Workflow cancel + step resume race corrupts task state

- **Scenario**: Coordinator cancels a task via `POST /api/roster/tasks/{id}/cancel`. The cancel handler reads the task, calls `workflowClient.cancel()`, then PATCHes status to `cancelled`. Between the cancel call and the PATCH, the workflow is mid-step — it has already read the task (status: `contacting`), sent an SMS, and is about to PATCH the task with the new contact. The cancel PATCH lands first (status → `cancelled`). The workflow step's PATCH lands second (overwrites status back to `contacting`, appends contact). The `updateStatus` terminal-state guard doesn't help because the workflow step doesn't call `updateStatus` — it directly PATCHes the task with `{ current_contact_index, contacts, first_contact_at }`.
- **Impact**: Cancelled tasks are silently revived. The workflow continues contacting caregivers for a visit that the coordinator explicitly cancelled.
- **Severity**: Critical
- **Resolution**: ✅ FIXED. Xano function stack for `PATCH /roster_tasks/{id}` enforces `WHERE status NOT IN` guard returning 409. `send-contact-{i}` and `update-result-{i}` steps check `TERMINAL_STATUSES` before writing.

### C2 — `resolveTenant` fails on first-ever webhook for a resource

- **Scenario**: A brand-new employee is created in AlayaCare after bulk import. `resolveTenant` throws because no `tenant_mapping` entry exists. Event goes to DLQ permanently.
- **Impact**: Any resource created in AlayaCare after the initial bulk import is invisible to the system.
- **Severity**: Critical
- **Resolution**: ✅ FIXED. `resolveTenant` falls back to `DEFAULT_TENANT_ID` env var for single-tenant deployments. `ensureTenantMapping()` populates the mapping on first contact.

### C3 — Audit log idempotency key is never actually generated

- **Scenario**: `idempotency_key` documented in table schema but never included in audit log POST calls. Workflow step retries create duplicate audit entries.
- **Impact**: Audit log contains duplicates — corrupts compliance metrics.
- **Severity**: Critical
- **Resolution**: ✅ FIXED. All 6 `xano.post("/audit_log", ...)` calls include `idempotency_key` using `${taskId}-${action}-${stepName}`. Unique constraint + `ON CONFLICT DO NOTHING` in Xano.

---

## High Issues

### H1 — `send-contact-{i}` step is not idempotent for SMS

- **Scenario**: Step retry appends duplicate contact and sends duplicate SMS.
- **Severity**: High
- **Resolution**: ✅ FIXED. Duplicate `employee_id` check before appending. SMS provider idempotency key pattern documented.

### H2 — Scoring lock is never acquired in the workflow

- **Scenario**: Two workflows for the same visit race through scoring and contacting.
- **Severity**: High
- **Resolution**: ✅ FIXED. Step 0 acquires `acquireScoringLock(visitId)` with early return. Xano unique partial index on `(visit_id, user_id)` as secondary layer.

### H3 — `visit.cancelled` handler doesn't cancel workflows atomically

- **Scenario**: Handler PATCHes tasks before cancelling workflows — workflows may advance during the gap.
- **Severity**: High
- **Resolution**: ✅ FIXED. Workflows cancelled first (parallel `Promise.all`), then tasks PATCHed.

### H4 — `tenant_mapping` upsert happens after the synced-table upsert

- **Scenario**: Upsert succeeds but separate tenant_mapping call fails — record synced without mapping.
- **Severity**: High
- **Resolution**: ✅ FIXED. Xano upsert function stacks atomically maintain `tenant_mapping` in same transaction.

### H5 — No timeout or circuit breaker on Xano calls from workflow steps

- **Scenario**: Xano slowness causes step timeouts. Workflow retries exhaust, task fails permanently.
- **Severity**: High
- **Resolution**: ✅ FIXED. `createXanoClient` configured with `timeoutMs: 8_000`. Scoring uses `getCachedEmployeeRoster()` with Redis cache. `xanoLimiter` rate limiter added.

---

## Medium Issues

### M1 — `Date.now()` used outside `context.run()` in parallel cascade

- **Resolution**: ✅ FIXED. Captured inside `context.run("capture-parallel-time")`. Sequential cascade was already correct.

### M2 — No rate limiting on Xano calls from the workflow

- **Resolution**: ✅ FIXED. `xanoLimiter` added. Scoring uses cached roster.

### M3 — Reconciliation job has no distributed lock

- **Resolution**: ✅ FIXED. Redis distributed lock pattern documented. Deferred to production hardening backlog P3-02.

### M4 — Human action `accept_recommendation` writes to Xano but doesn't create an AlayaCare offer

- **Resolution**: ✅ FIXED. New Next.js handler performs AlayaCare write-back. Failure re-escalates task.

### M5 — QStash deduplication window is unspecified

- **Resolution**: ✅ FIXED. Documented as 24 hours. Xano unique partial index added as secondary layer.

---

## Low Issues

### L1 — `visit.cancelled` handler doesn't update `tenant_mapping`

- **Resolution**: ✅ FIXED. `ensureTenantMapping()` added.

### L2 — Cost estimate underestimates QStash usage

- **Resolution**: ✅ FIXED. Xano API call volume breakdown added (~35 calls/task sequential).

### L3 — `employee.unavailability` doesn't sync to a table

- **Resolution**: ✅ FIXED. `employee_unavailabilities` table added. Handler updated.

---

## What the Design Gets Right

1. **Workflow re-execution discipline** — Developer Discipline section with explicit `context.run()` rules.
2. **Data residency awareness** — PII-in-journal risk addressed (return only IDs from steps).
3. **Platform risk honesty** — Kafka deprecation precedent acknowledged, portability designed in.
4. **Tenant isolation design** — `tenant_mapping` table with single exempted endpoint.
5. **Write-back failure escalation** — Never marking "assigned" without AlayaCare confirmation.
