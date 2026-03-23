# Deferred Architecture Items

**Created:** 2026-03-11
**Source plan:** `docs/plans/cronicle-architecture-migration.md`
**Context:** The Cronicle architecture migration (Phases 0-3, partial 5-6) is substantially complete. The items below were explicitly deferred because their cost exceeds their benefit at current scale. Each has a trigger condition — implement when the trigger fires, not before.

---

## 1. Supabase Realtime (Phase 4)

**What it is:** Server-side Supabase Realtime subscriptions that push data changes to clients via SSE, replacing polling/refetch-on-focus.

**Why it was deferred:** The app is single-user. TanStack Query's `refetchOnFocus` and optimistic updates handle all current UX needs. Realtime adds Supabase client dependencies, SSE connection management, reconnection logic, and Vercel serverless connection limits — all for features that don't exist yet.

**Current workaround:** TanStack Query handles cache invalidation. Add `refetchInterval: 30_000` to any query that needs near-real-time updates (1 line vs an infrastructure layer).

**Trigger — implement when ANY of these become true:**
- Users need to see other users' changes without refreshing (collaborative features)
- Notifications must appear instantly (not on next page load)
- The AlayaCare rostering workflow requires live status updates pushed to the operations dashboard
- Chat expands beyond single-user AI chat to team/multi-user chat

**Implementation sketch:**
1. Create `src/lib/realtime/channel-manager.ts` — manages per-user SSE connections
2. Subscribe to `postgres_changes` via `supabaseAdmin` (service role key, bypasses RLS)
3. Filter events by `user_id` before pushing to correct SSE connection
4. Client hook: `useRealtimeUpdates(resource, id)` wrapping SSE subscription
5. Design decision D1 (in migration plan) already chose server-side Realtime over client-side RLS subscriptions

**Estimated effort:** 2-3 days
**Risk if deferred too long:** Low. Polling works fine for single-user CRUD.

---

## 2. Outbox Pattern + Worker (Phase 6.3)

**What it is:** A transactional outbox table that captures side-effect intents (emails, webhooks, external API calls) within the same DB transaction as the business mutation. A background worker processes the outbox and delivers the side effects with at-least-once guarantees.

**Why it was deferred:** An outbox without a worker accumulates unprocessed rows. No current feature needs async side effects. The UoW interface already has an `outbox` slot typed as `OutboxWriter | null` (see `src/server/uow/types.ts`) so the extension point is ready.

**Current workaround:** For simple side effects (e.g., sending an email after a mutation), call the external service directly in the handler after the UoW commits. This is "best effort" — if the call fails, the mutation still succeeded but the side effect is lost.

**Trigger — implement when ANY of these become true:**
- A feature requires a side effect that MUST happen reliably (e.g., SMS notification to a caregiver after roster assignment)
- You need to sync data to an external system after mutations (e.g., writing back to AlayaCare)
- You're seeing intermittent failures in direct side-effect calls and need retry/dead-letter semantics
- The rostering workflow's communication layer (SMS/email to caregivers) goes to production

**Implementation sketch:**
1. Migration: Create `outbox` table (`id`, `aggregate_type`, `aggregate_id`, `event_type`, `payload`, `created_at`, `processed_at`, `retry_count`, `dead_at`)
2. Add `OutboxWriter` to `TransactionContext` in UoW — writes to outbox within the same transaction
3. Worker options: Supabase Edge Function (cron), Vercel Cron, or AWS Lambda polling the table
4. Dead-letter: After N retries (default 5), move to `dead_at` timestamp. Alert via structured logger.
5. Design decision D8 (in migration plan) documents this approach

**Estimated effort:** 3-4 days (including worker deployment)
**Risk if deferred too long:** Medium. Once the rostering communication layer is built, unreliable SMS/email delivery becomes a real problem. Plan to implement this before rostering goes to production.

---

## 3. Idempotency Keys (Phase 6.4)

**What it is:** An `idempotency_keys` table that stores request fingerprints. Clients send an `Idempotency-Key` header; the server returns the cached response if the key has been seen, preventing duplicate mutations.

**Why it was deferred:** Web browsers don't retry POST requests on their own. TanStack Query mutations have built-in deduplication. The risk of duplicate operations in a single-user web app is near zero.

**Current workaround:** TanStack Query's `mutationKey` deduplication prevents double-clicks. The UoW's transaction isolation prevents concurrent duplicate writes at the DB level.

**Trigger — implement when ANY of these become true:**
- You build a mobile app where network reliability is poor and HTTP requests may be retried by the client or network layer
- You accept webhooks from external services (e.g., AlayaCare, Twilio) that may deliver duplicate events
- You process financial transactions or other operations where duplicates are unacceptable
- Caregiver-facing mobile interface is added to the rostering workflow

**Implementation sketch:**
1. Migration: Create `idempotency_keys` table (`key`, `user_id`, `response_status`, `response_body`, `created_at`, `expires_at`)
2. Add `IdempotencyStore` to `TransactionContext` in UoW
3. Middleware or handler wrapper: check key before executing, store result after executing
4. TTL-based cleanup (e.g., expire after 24 hours)

**Estimated effort:** 2 days
**Risk if deferred too long:** Low for web-only. Becomes important when mobile clients or webhooks are added.

---

## 4. CI Fitness Functions (Phase 6.6)

**What it is:** Automated architectural guardrails enforced in CI:
- No `next/*` or `react` imports in `src/server/` directory
- Route handler line count < 60 lines
- No direct `db.` calls in handlers (must go through UoW or ReadOnly)

**Why it was deferred:** You can enforce these conventions manually when you're the sole developer. The rules are documented in the migration plan and CLAUDE.md. Custom ESLint rules or scripts add maintenance overhead that isn't justified until the team scales.

**Current workaround:** Conventions documented in CLAUDE.md and enforced during code review. Claude Code follows these patterns when generating code.

**Trigger — implement when ANY of these become true:**
- The team grows beyond 1-2 developers
- You find yourself repeatedly catching the same pattern violations in code review
- A new developer introduces a `next/headers` import in a server handler (the exact bug these checks prevent)

**Implementation sketch:**
1. Add custom ESLint rules or a simple shell script in CI
2. `grep -r "from 'next/" src/server/` should return 0 results
3. `wc -l` on route files should be < 60
4. `grep -r "from.*db.*index" src/server/commands src/server/queries` should return 0 results
5. Run as a CI step after lint/typecheck

**Estimated effort:** 0.5 days
**Risk if deferred too long:** Low. Convention drift is slow and easy to fix retroactively.

---

## 5. Response Schema Validation (Phase 5 remainder)

**What it is:** Zod schemas for API responses, validated before returning from route handlers. Catches accidental field exposure (e.g., leaking internal IDs or sensitive data).

**Why it was deferred:** The API surface is still evolving with the AlayaCare pivot. Writing response schemas for shapes that change weekly is overhead. Input validation (already implemented on all handlers) covers the highest-risk direction.

**Current workaround:** Services use explicit Drizzle column selection (not `select *`), reducing the risk of accidental field exposure.

**Trigger — implement when ANY of these become true:**
- You build a mobile app or external API consumer that needs a stable contract
- You open the API to third parties
- You accidentally expose a sensitive field in a response
- The API surface stabilises post-PoC

**Estimated effort:** 2-3 days
**Risk if deferred too long:** Low-medium. Mitigated by explicit column selection in services.

---

## Removed Items (No Longer Applicable)

The following items from the original migration plan have been superseded:

| Item | Status | Reason |
|------|--------|--------|
| Phase 3 policies for projects/meetings/chat | Removed | Domain entities deleted after AlayaCare pivot. Policy pattern preserved in user/session handlers. |
| `secureHandler` removal | Done | Replaced by `requireAuthContext` + UoW in Phase 1. |
| `withTenantContext` removal | Done | Replaced by UoW `SET LOCAL` injection. |
| Service `eq(userId)` WHERE clause removal | Done | RLS via `auth.uid()` handles row scoping (migration 009). |
| API versioning (Phase 6.5) | Done | Routes under `app/api/v1/`, rewrites in `next.config.ts`. |
| Trace IDs (Phase 6.1) | Done | `traceId` in `AuthContext` + error envelope. |
| Structured logger (Phase 6.2) | Done | `src/lib/logger.ts` — JSON in prod, readable in dev. |
