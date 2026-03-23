# Production Hardening Backlog

Deferred work items from the Phase 1 implementation spec. These are real issues identified during adversarial review, but they are not required for initial deployment (single-tenant, low volume).

**Sources**:
- `docs/reviews/system-review-2026-03-15.md` — Upstash + Xano architecture review
- `docs/reviews/system-review-2026-03-13.md` — Current codebase review
- `docs/upstash-xano-architecture.md` — Full architecture reference (parallel cascade, multi-tenant, reconciliation)

---

## Priority 1 — Before Production Traffic

### P1-01: SMS Provider Signature Verification

**Source**: Architecture doc, SMS Response Handler
**Status**: Stub in Phase 1 (throws in production, skips in dev)

The `verifyTwilioSignature()` function is a placeholder. Before enabling SMS in production:
1. Implement real Twilio `validateRequest()` verification
2. Add IP allowlist for SMS provider callback IPs
3. Remove the `NODE_ENV === "production"` throw guard

**Effort**: 2 hrs

### P1-02: Dev Reset Endpoint Environment Guard

**Source**: system-review-2026-03-13 CRITICAL-01
**Status**: NOT FIXED

`POST /api/v1/dev/reset` has no `NODE_ENV` guard. Any authenticated user can truncate all rostering data. Add guard or delete endpoint from production build.

**Effort**: 30 min

### P1-03: Bulk Import + tenant_mapping Population

**Source**: Architecture doc, system-review-2026-03-15 C2
**Status**: Design only — no implementation

The admin bulk import endpoint (`/api/admin/sync-alayacare`) needs to be built. Must populate all synced tables + `tenant_mapping` entries. Without this, `resolveTenant()` relies entirely on `DEFAULT_TENANT_ID` fallback.

**Effort**: 8 hrs

---

## Priority 2 — Before Multi-Tenant

### P2-01: Per-Tenant Webhook Endpoints

**Source**: system-review-2026-03-15 C2
**Status**: Deferred (using DEFAULT_TENANT_ID fallback for single-tenant)

For multi-tenant: configure per-tenant webhook URLs (`/api/webhooks/alayacare/{tenantId}`) so tenant resolution doesn't require the `tenant_mapping` lookup at all. Eliminates the bootstrap problem for new resources.

**Effort**: 4 hrs

### P2-02: Xano RLS / Tenant Isolation Enforcement

**Source**: system-review-2026-03-13 CRITICAL-03
**Status**: NOT FIXED (current codebase uses postgres BYPASSRLS)

In the new architecture, Xano function stacks enforce `WHERE user_id = :userId`. But this must be verified for every endpoint during multi-tenant setup. Consider Xano's built-in role-based access if available.

**Effort**: 4 hrs

### P2-03: AlayaCare Proxy Route Authorization

**Source**: system-review-2026-03-13 HIGH-05
**Status**: NOT FIXED

Proxy routes return all AlayaCare data regardless of user scope. For multi-tenant, scope queries by user's organisation.

**Effort**: 4 hrs

### P2-04: Connection Pool Verification

**Source**: system-review-2026-03-13 HIGH-02
**Status**: Structurally resolved by migration to Xano (no direct DB connection from Next.js)

Verify Xano handles connection pooling internally. No action needed unless custom Xano function stacks hit pool limits.

**Effort**: 0 hrs (verify only)

### P2-05: State Transition Validation Verification

**Source**: system-review-2026-03-13 HIGH-03
**Status**: Structurally resolved by Upstash Workflow (linear flow replaces state machine switch)

The workflow's linear structure (`score → reason → contact → wait → assign/escalate`) makes illegal transitions impossible — there's no state machine to corrupt. The Xano `PATCH` terminal-state guard provides additional protection.

**Effort**: 0 hrs (verify only)

---

## Priority 3 — Scale & Resilience

### P3-01: Parallel Cascade

**Source**: Architecture doc (full design exists)
**Status**: Design complete, not in Phase 1 implementation spec

Full parallel cascade implementation with `waitForEvent` polling. Known limitation: sequential polling creates worst-case delay of `(batchSize - 1) × expiryMinutes`. Mitigations documented in architecture doc.

**Effort**: 8 hrs

### P3-02: Reconciliation Job

**Source**: Architecture doc, system-review-2026-03-15 M3
**Status**: Design complete, not in Phase 1

Periodic QStash cron that diffs local synced tables against AlayaCare API and patches gaps. Staggered schedule (employees :00/:15/:30/:45, clients :05/:20/:35/:50, visits :10/:25/:40/:55). Must include distributed lock (`SET lock:reconcile:${table} 1 EX 300 NX`).

**Full design**: `docs/upstash-xano-architecture.md` § Reconciliation Job

**Effort**: 12 hrs

### P3-03: Circuit Breaker on Xano Calls

**Source**: system-review-2026-03-15 H5
**Status**: Partially addressed (timeout + rate limiter added)

Full circuit breaker: if Xano fails N times in a window, pause workflow triggers and alert. Currently mitigated by 8s fetch timeout and `xanoLimiter` rate limiter.

**Effort**: 4 hrs

### P3-04: Orphaned Task Recovery

**Source**: system-review-2026-03-13 HIGH-06
**Status**: Structurally resolved by Upstash Workflow (durable execution replaces crash-vulnerable Promise.allSettled)

Verify that Upstash Workflow's built-in retry covers all orphan scenarios. May still need a reconciliation query for tasks stuck in `idle` > 5 minutes if workflow trigger fails.

**Effort**: 2 hrs

### P3-05: Dead Letter Queue + Alerting

**Source**: Architecture doc
**Status**: Design only

When QStash exhausts retries, route to Redis DLQ list. Alert on depth > 0. Build admin UI to inspect and replay failed events.

**Effort**: 6 hrs

---

## Priority 4 — Operational Excellence

### P4-01: Observability (Option B — Datadog APM)

**Source**: Architecture doc, observability-plan.md
**Status**: Phase 1 uses Option A (zero cost: Upstash Console + Vercel Dashboard + structured logging)

Upgrade to Datadog APM ($15/month) when debugging production workflow issues across webhook → QStash → workflow → Xano/Bedrock becomes a bottleneck.

**Effort**: 8 hrs

### P4-02: Staleness Detection at Scoring Time

**Source**: Architecture doc
**Status**: Design only

Before scoring, check `synced_at` on critical records. If any employee/visit hasn't synced within 30 minutes, log warning and optionally trigger on-demand refresh.

**Effort**: 4 hrs

### P4-03: Pattern Recognition + Outcome Tracking

**Source**: Current codebase (already built), architecture doc
**Status**: Code exists (`outcome-tracker.ts`, `pattern-recognition.ts`) — needs Xano integration

Port `analysePatterns()` (always_declines, client_churn, high_escalation) and `extractOutcome()` to query Xano instead of Drizzle.

**Effort**: 4 hrs

### P4-04: Startup Environment Variable Validation

**Source**: system-review-2026-03-13 MEDIUM-08
**Status**: NOT FIXED

Validate all required env vars at boot (Next.js `instrumentation.ts` register hook). Currently, missing vars fail silently at first request.

**Effort**: 2 hrs

### P4-05: Error Response Detail Stripping

**Source**: system-review-2026-03-13 MEDIUM-07
**Status**: NOT FIXED

Zod validation errors currently return full `issues` array to client. Strip `details` in production.

**Effort**: 1 hr

---

## Priority 5 — Nice to Have

### P5-01: Chat Interface Write Tool Idempotency

**Source**: system-review-2026-03-13 MEDIUM-01
**Status**: NOT FIXED

Add `confirmation_id` (UUID) to chat write confirmations to prevent duplicate execution on network retry.

**Effort**: 2 hrs

### P5-02: Platform Risk Mitigation

**Source**: Architecture doc
**Status**: Documented — no action needed now

Upstash Kafka deprecation precedent acknowledged. Business logic in pure TypeScript, Upstash is infrastructure glue only. Portability path documented (Redis → any provider, QStash → BullMQ/SQS, Workflow → Inngest/Restate).

**Effort**: 0 hrs (monitor only)

---

## Summary

| Priority | Items | Total Effort |
|----------|-------|-------------|
| P1 — Before production traffic | 3 | 10.5 hrs |
| P2 — Before multi-tenant | 5 | 12 hrs |
| P3 — Scale & resilience | 5 | 32 hrs |
| P4 — Operational excellence | 5 | 19 hrs |
| P5 — Nice to have | 2 | 2 hrs |
| **Total** | **20** | **~75.5 hrs** |

Items from the 2026-03-13 review that are **structurally resolved** by the Xano migration (no action needed):
- HIGH-02: Connection pool config → Xano handles this (verify: P2-04)
- HIGH-03: State machine validation → linear workflow replaces switch (verify: P2-05)
- HIGH-04: JSONB contact race → Xano function stack with terminal guard
- HIGH-06: Orphaned tasks → Upstash Workflow durable execution
- MEDIUM-04: N+1 skills fetch → bulk fetch + Redis cache (already implemented)
- CRITICAL-02: Webhook double-dispatch → QStash dedup + scoring lock + DB constraint
