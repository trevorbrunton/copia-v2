# Cronicle Architecture Migration Plan

**Status:** SUBSTANTIALLY COMPLETE (2026-03-11). Phases 0–3 implemented, Phase 5 implemented (API versioning subset), Phase 6.1–6.2 implemented. Orphaned handlers/services/tests from pre-pivot domain (projects/meetings/chat) removed 2026-03-11. Remaining items (Phase 4, 6.3–6.6) explicitly deferred — see `docs/dev-notes/deferred-architecture-items.md`.
**Source spec:** `app_architecture_optimal_spec.md` (v1.2)
**Current state:** Layered architecture with Command/Query handlers, UoW, Defense in Depth RLS policies (bypassed by Supabase postgres role — tenant isolation via service-layer WHERE clauses)
**Target state:** Full spec with policies, Realtime, contracts, and operational hardening — added incrementally when triggered

---

## Design Decisions (Resolved)

### D1: Supabase Realtime Authentication Strategy

**Decision:** Use server-side Supabase Realtime via service role key, NOT client-side subscriptions with RLS.

**Rationale:** Supabase client-side Realtime requires Supabase Auth JWTs for RLS (`auth.uid()`). Our app uses Cognito. Bridging them (custom JWTs, dual auth) adds complexity with no clear payoff. Instead:

- Server subscribes to `postgres_changes` using the service role key
- Server pushes to clients via our own SSE endpoints (pattern already proven with chat streaming)
- Client hooks use TanStack Query with `refetchInterval` or SSE subscriptions for real-time feel
- If we later migrate to Supabase Auth, client-side Realtime becomes trivial to add

**Implication:** No dual RLS policies needed. All RLS uses `current_tenant_id()` only.

### D2: RLS Variable Rename Strategy

**Decision:** Atomic same-commit deployment. Migration 007 drops old policies, creates new ones using `current_tenant_id()` function, and application code changes in the same commit.

**Rationale:** The app is small (8 tables, 7 policies). A two-phase migration with dual policies adds complexity for a risk window measured in seconds. Deploy both together.

### D3: Bootstrap Context Survival

**Decision:** `withBootstrapContext()` and `getOrCreateUser()` remain outside the UoW. They are the only code path that runs without tenant context.

**Rationale:** At bootstrap time (first request from a new Cognito user), the DB user ID (`principalId`) doesn't exist yet. The UoW requires `AuthContext` with `principalId`. This is an intentional, documented exception to the "everything through UoW" rule.

### D4: Streaming Chat as Documented Exception

**Decision:** The chat stream route handler is exempt from the "~40 lines" rule. It orchestrates two commands and a query across a streaming response boundary.

**Structure:**
```
POST /api/chat/stream
  1. requireAuthContext(req) -> ctx
  2. handleSaveUserMessage(deps, input, ctx)     // Command: save user msg
  3. handleLoadMessageHistory(deps, input, ctx)   // Query: load history
  4. Return SSE Response with stream callback:
     5. streamChat(messages) -> tokens            // I/O: LLM streaming
     6. handleSaveAssistantMessage(deps, ..., ctx) // Command: save assistant msg
```

The route handler owns the SSE lifecycle. Commands 2 and 6 each use their own UoW. This is ~60 lines and explicitly documented as an architectural exception.

### D5: Service-to-Repository Transition

**Decision:** Keep current services as-is initially. Command/query handlers wrap them. Rename to repositories only when handler logic diverges from pass-through.

**Rationale:** Current services are already well-structured `(tx, userId, ...)` CRUD functions. Renaming them immediately to "repositories" and adding thin handler wrappers doubles the file count with no behavior change. Instead:

- Phase 1: Add handler layer that calls existing service functions
- Phase 2: When UoW is introduced, handlers open the UoW and pass `tx` to services
- Future: When a service grows complex, split it into repository (writes) + query service (reads)

### D6: Authorization Layers — Eliminate Redundancy

**Decision:** Three-layer model with clear responsibilities:

| Layer | Responsibility | Example |
|---|---|---|
| Policy (Application) | "Can this user perform this action?" | `policy.assertCanEdit(ctx, resource)` |
| RLS (Database) | "Hard backstop — filter to tenant's rows" | `current_tenant_id()` |
| ~~Service WHERE clause~~ | ~~Removed~~ | ~~`eq(projects.userId, userId)`~~ |

Current services include `eq(userId)` in WHERE clauses redundantly with RLS. When handlers are introduced, repositories will trust RLS for row scoping. The `userId` filter moves to the policy layer as a business check, not a query filter.

**Migration path:** Don't remove `eq(userId)` from services until RLS with `current_tenant_id()` is verified working (end of Phase 2).

### D7: Incremental `secureHandler` Migration

**Decision:** Add `requireAuthContext()` alongside `secureHandler`. Migrate routes one-by-one. Deprecate `secureHandler` only after all routes use the new pattern.

**`requireAuthContext()` does:**
1. Verify auth token (cookie or Bearer)
2. `getOrCreateUser()` (bootstrap context)
3. Check account status (suspended/deleted)
4. Return `AuthContext` object

**`requireAuthContext()` does NOT:**
- Open a transaction (that's the handler's job via UoW)
- Call the route handler (the route handler calls it)

### D8: Outbox — Defer Table Creation

**Decision:** Don't create the outbox table until the first feature needs async events. Add it to the schema file as a commented-out reference design.

**Rationale:** An outbox without a worker accumulates unprocessed rows. No current feature needs async events. The UoW interface will include an `outbox` slot (typed as `OutboxWriter | null`) so the pattern is ready when needed.

### D9: Testing Before Refactoring

**Decision:** Add a small set of integration tests before Phase 1 to catch regressions.

**Critical test paths:**
1. Auth flow: token verification -> `getOrCreateUser` -> response
2. RLS enforcement: query without tenant context returns empty results
3. Chat stream: user message saved, assistant message saved, SSE completes
4. Account status: suspended user gets 403

These tests validate current behavior and survive the refactor.

---

## Phase 0: Safety Net (Tests)

**Goal:** Establish regression tests before any structural changes.

### 0.1 Test infrastructure setup

Create test configuration and helpers:

```
src/
  test/
    setup.ts              # Test DB connection, cleanup
    helpers.ts            # createTestUser, createTestProject, etc.
    auth-helpers.ts       # Mock auth context, mock tokens
```

- Use Vitest (already compatible with the stack)
- Test database: use the same Supabase instance with a test schema or transaction rollback pattern
- Add `vitest` and `@testing-library/react` to devDependencies

### 0.2 Critical path integration tests

```
src/
  test/
    integration/
      auth-flow.test.ts           # Token -> getOrCreateUser -> response
      rls-enforcement.test.ts     # Tenant isolation verification
      project-crud.test.ts        # Representative CRUD through API
      account-status.test.ts      # Suspended/deleted user gets 403
```

### 0.3 Chat stream test

```
src/
  test/
    integration/
      chat-stream.test.ts        # SSE lifecycle, both messages saved
```

**Files created:** ~6
**Files changed:** 1 (package.json)

---

## Phase 1: Foundation (Structural Layer)

**Goal:** Establish AuthContext, error classes, composition root, and handler wrappers around existing services. Incremental — no breaking changes.

### 1.1 AuthContext type

```typescript
// src/server/auth-context.ts
export type AuthContext = {
  principalId: string;    // DB user.id (UUID)
  cognitoId: string;      // Cognito sub
  email: string;
  roles: string[];        // Future: from Cognito groups, default []
};
```

### 1.2 Domain error classes

```typescript
// src/server/errors.ts
export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
    public readonly details?: unknown
  ) { super(message); }
}

export class NotFoundError extends AppError { /* 404 */ }
export class ForbiddenError extends AppError { /* 403 */ }
export class ConflictError extends AppError { /* 409 */ }
export class ValidationError extends AppError { /* 400 */ }
```

### 1.3 Error envelope

Update `api-response.ts` to support the spec's error envelope format:

```typescript
type ApiErrorEnvelope = {
  error: {
    code: string;
    message: string;
    details?: unknown;
    traceId?: string;
  };
};
```

Add a `handleAppError(err: unknown): Response` helper that maps `AppError` subclasses to HTTP responses with the envelope format. Existing response helpers remain for backward compatibility during migration.

### 1.4 `requireAuthContext()` function

```typescript
// src/server/require-auth-context.ts
import { getServerUserFromRequest } from "@/src/auth/server";
import { getOrCreateUser } from "@/src/lib/auth";
import { AuthContext } from "./auth-context";
import { ForbiddenError } from "./errors";

export async function requireAuthContext(req: Request): Promise<AuthContext> {
  const authUser = await getServerUserFromRequest(req);
  if (!authUser) throw new UnauthorizedError();

  const dbUser = await getOrCreateUser(authUser.userId, authUser.email, authUser.name);

  if (dbUser.status === "suspended")
    throw new ForbiddenError("Account suspended", "ACCOUNT_SUSPENDED", 403);
  if (dbUser.status === "soft_deleted")
    throw new ForbiddenError("Account deleted", "ACCOUNT_DELETED", 403);

  return {
    principalId: dbUser.id,
    cognitoId: authUser.userId,
    email: dbUser.email!,
    roles: [],  // Future: populate from Cognito groups
  };
}
```

### 1.5 Composition root

```typescript
// src/server/make-deps.ts
import * as projectService from "@/src/services/project-service";
import * as chatService from "@/src/services/chat-service";
import * as meetingService from "@/src/services/meeting-service";
// ... etc

export function makeDeps() {
  return {
    // Services (will become repositories later)
    projectService,
    chatService,
    meetingService,
    // Policies (Phase 3)
    // projectPolicy: new ProjectPolicy(),
  };
}

export type AppDeps = ReturnType<typeof makeDeps>;
```

### 1.6 Command and query handler wrappers

Create handlers that wrap existing service calls. Start with projects as the reference implementation:

```
src/server/
  commands/
    projects/
      create-project.ts
      update-project.ts
      delete-project.ts
  queries/
    projects/
      list-projects.ts
      get-project.ts
```

**Example command handler:**

```typescript
// src/server/commands/projects/create-project.ts
import { z } from "zod";
import { AuthContext } from "../../auth-context";
import { withTenantContext } from "@/src/lib/tenant";
import { createProject } from "@/src/services/project-service";

export const CreateProjectInput = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  status: z.string().optional(),
});

export async function handleCreateProject(
  rawInput: unknown,
  ctx: AuthContext,
) {
  const input = CreateProjectInput.parse(rawInput);

  // Phase 1: Use existing withTenantContext
  // Phase 2: Replace with UoW
  return withTenantContext(ctx.principalId, async (tx) => {
    return createProject(tx, ctx.principalId, input);
  });
}
```

**Example query handler:**

```typescript
// src/server/queries/projects/list-projects.ts
import { z } from "zod";
import { AuthContext } from "../../auth-context";
import { withTenantContext } from "@/src/lib/tenant";
import { listProjects } from "@/src/services/project-service";

export const ListProjectsInput = z.object({
  search: z.string().optional(),
  status: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export async function handleListProjects(
  rawInput: unknown,
  ctx: AuthContext,
) {
  const input = ListProjectsInput.parse(rawInput);

  return withTenantContext(ctx.principalId, async (tx) => {
    return listProjects(tx, ctx.principalId, input);
  });
}
```

### 1.7 Migrate routes incrementally

Convert one route file at a time from `secureHandler` to `requireAuthContext` + handler:

```typescript
// app/api/projects/route.ts (AFTER migration)
import { requireAuthContext } from "@/src/server/require-auth-context";
import { handleCreateProject } from "@/src/server/commands/projects/create-project";
import { handleListProjects } from "@/src/server/queries/projects/list-projects";
import { handleAppError } from "@/src/server/errors";

export async function GET(req: Request) {
  try {
    const ctx = await requireAuthContext(req);
    const url = new URL(req.url);
    const result = await handleListProjects(Object.fromEntries(url.searchParams), ctx);
    return Response.json(result);
  } catch (err) {
    return handleAppError(err);
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await requireAuthContext(req);
    const body = await req.json();
    const result = await handleCreateProject(body, ctx);
    return Response.json(result, { status: 201 });
  } catch (err) {
    return handleAppError(err);
  }
}
```

**Migration order (least risk first):**
1. `projects/route.ts` + `projects/[id]/route.ts` (simplest CRUD)
2. `meetings/route.ts` + `meetings/[id]/route.ts`
3. `user/route.ts` (profile)
4. `user/sessions/route.ts` + `user/sessions/[id]/route.ts`
5. `user/devices/route.ts` + `user/devices/[id]/route.ts`
6. `user/login-history/route.ts`
7. `user/account/route.ts`
8. `chat/conversations/route.ts` + `chat/conversations/[id]/route.ts` + messages
9. `chat/stream/route.ts` (special case — see D4)
10. `auth/session/route.ts` (no auth context needed — this IS the auth endpoint)

Run tests after each migration step.

### 1.8 Folder structure after Phase 1

```
src/server/
  auth-context.ts
  errors.ts
  require-auth-context.ts
  make-deps.ts
  commands/
    projects/
      create-project.ts
      update-project.ts
      delete-project.ts
    chat/
      create-conversation.ts
      delete-conversation.ts
      save-user-message.ts
      save-assistant-message.ts
    meetings/
      create-meeting.ts
      update-meeting.ts
      delete-meeting.ts
    users/
      update-profile.ts
      delete-account.ts
  queries/
    projects/
      list-projects.ts
      get-project.ts
    chat/
      list-conversations.ts
      get-conversation.ts
      list-messages.ts
    meetings/
      list-meetings.ts
      get-meeting.ts
    users/
      get-profile.ts
      list-sessions.ts
      list-devices.ts
      get-login-history.ts
```

**Files created:** ~30 (handlers, auth-context, errors, make-deps)
**Files changed:** ~16 (route handlers, api-response.ts, package.json)

---

## Phase 2: Transaction Discipline (UoW + RLS Hardening)

**Goal:** Introduce UnitOfWork with Defense in Depth identity injection. Rename RLS variable. Add read-only query wrapper.

**Prerequisite:** Phase 1 complete. All routes using `requireAuthContext` + handlers.

### 2.1 Database migration 007

```sql
-- 007: Defense in Depth foundation

-- 1. Helper function for RLS (spec requirement)
CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS text AS $$
  SELECT NULLIF(current_setting('app.current_tenant_id', true), '');
$$ LANGUAGE sql STABLE;

-- 2. Drop old RLS policies (using app.tenant_id)
DROP POLICY IF EXISTS users_tenant_isolation ON users;
DROP POLICY IF EXISTS projects_tenant_isolation ON projects;
DROP POLICY IF EXISTS chat_conversations_tenant_isolation ON chat_conversations;
DROP POLICY IF EXISTS chat_messages_tenant_isolation ON chat_messages;
DROP POLICY IF EXISTS user_status_history_tenant_isolation ON user_status_history;
DROP POLICY IF EXISTS user_devices_tenant_isolation ON user_devices;
DROP POLICY IF EXISTS user_sessions_tenant_isolation ON user_sessions;
DROP POLICY IF EXISTS meetings_tenant_policy ON meetings;

-- 3. Create new policies using current_tenant_id() function
CREATE POLICY users_tenant_isolation ON users
  FOR ALL USING (id::text = current_tenant_id());

CREATE POLICY projects_tenant_isolation ON projects
  FOR ALL USING (user_id::text = current_tenant_id());

CREATE POLICY chat_conversations_tenant_isolation ON chat_conversations
  FOR ALL USING (user_id::text = current_tenant_id());

CREATE POLICY chat_messages_tenant_isolation ON chat_messages
  FOR ALL USING (user_id::text = current_tenant_id());

CREATE POLICY user_status_history_tenant_isolation ON user_status_history
  FOR ALL USING (user_id::text = current_tenant_id());

CREATE POLICY user_devices_tenant_isolation ON user_devices
  FOR ALL USING (user_id::text = current_tenant_id());

CREATE POLICY user_sessions_tenant_isolation ON user_sessions
  FOR ALL USING (user_id::text = current_tenant_id());

CREATE POLICY meetings_tenant_isolation ON meetings
  FOR ALL USING (user_id::text = current_tenant_id())
  WITH CHECK (user_id::text = current_tenant_id());

-- 4. Keep bootstrap policy (unchanged — uses true, not tenant_id)
-- users_cognito_lookup already exists from migration 004
```

### 2.2 Update `tenant.ts` — rename variable

Change `app.tenant_id` to `app.current_tenant_id` in both `withTenantContext` and `withBootstrapContext`. This MUST deploy in the same commit as migration 007.

```typescript
// src/lib/tenant.ts
// Change: SET LOCAL app.tenant_id = ...
// To:     SET LOCAL app.current_tenant_id = ...
```

### 2.3 UnitOfWork interfaces

```typescript
// src/server/uow/types.ts
import type { TransactionClient } from "@/src/lib/tenant";

export interface TransactionContext {
  db: TransactionClient;
  // outbox: OutboxWriter;         // Phase future: when first async event needed
  // idempotency: IdempotencyStore; // Phase future: when mobile or webhooks added
}

export interface UnitOfWork {
  run<T>(ctx: AuthContext, fn: (tx: TransactionContext) => Promise<T>): Promise<T>;
}

export interface ReadOnlyContext {
  db: TransactionClient;
}

export interface ReadOnlyExecutor {
  run<T>(ctx: AuthContext, fn: (tx: ReadOnlyContext) => Promise<T>): Promise<T>;
}
```

### 2.4 UnitOfWork implementation

```typescript
// src/server/uow/drizzle-uow.ts
import { sql } from "drizzle-orm";
import { db } from "@/src/db";
import type { AuthContext } from "../auth-context";
import type { UnitOfWork, TransactionContext, ReadOnlyExecutor, ReadOnlyContext } from "./types";

export class DrizzleUoW implements UnitOfWork {
  async run<T>(
    ctx: AuthContext,
    fn: (tx: TransactionContext) => Promise<T>
  ): Promise<T> {
    return db.transaction(async (tx) => {
      // Defense in Depth: inject identity into Postgres transaction
      await tx.execute(
        sql`SET LOCAL app.current_tenant_id = ${ctx.principalId}`
      );
      await tx.execute(sql.raw(`SET LOCAL statement_timeout = '30000'`));

      return fn({ db: tx });
    });
  }
}

export class DrizzleReadOnly implements ReadOnlyExecutor {
  async run<T>(
    ctx: AuthContext,
    fn: (tx: ReadOnlyContext) => Promise<T>
  ): Promise<T> {
    return db.transaction(async (tx) => {
      await tx.execute(
        sql`SET LOCAL app.current_tenant_id = ${ctx.principalId}`
      );
      await tx.execute(
        sql.raw(`SET LOCAL default_transaction_read_only = 'on'`)
      );
      return fn({ db: tx });
    });
  }
}
```

### 2.5 Update composition root

```typescript
// src/server/make-deps.ts (updated)
import { DrizzleUoW, DrizzleReadOnly } from "./uow/drizzle-uow";

export function makeDeps() {
  return {
    uow: new DrizzleUoW(),
    readOnly: new DrizzleReadOnly(),
    // ... services
  };
}
```

### 2.6 Update command handlers to use UoW

```typescript
// src/server/commands/projects/create-project.ts (updated)
export async function handleCreateProject(
  deps: { uow: UnitOfWork },
  rawInput: unknown,
  ctx: AuthContext,
) {
  const input = CreateProjectInput.parse(rawInput);

  return deps.uow.run(ctx, async ({ db: tx }) => {
    return createProject(tx, ctx.principalId, input);
  });
}
```

### 2.7 Update query handlers to use ReadOnlyExecutor

```typescript
// src/server/queries/projects/list-projects.ts (updated)
export async function handleListProjects(
  deps: { readOnly: ReadOnlyExecutor },
  rawInput: unknown,
  ctx: AuthContext,
) {
  const input = ListProjectsInput.parse(rawInput);

  return deps.readOnly.run(ctx, async ({ db: tx }) => {
    return listProjects(tx, ctx.principalId, input);
  });
}
```

### 2.8 Chat stream: two separate commands

```typescript
// src/server/commands/chat/save-user-message.ts
export async function handleSaveUserMessage(
  deps: { uow: UnitOfWork },
  rawInput: { conversationId: string; message: string },
  ctx: AuthContext,
) {
  return deps.uow.run(ctx, async ({ db: tx }) => {
    const conversation = await getConversation(tx, ctx.principalId, rawInput.conversationId);
    if (!conversation) throw new NotFoundError("Conversation not found", "CONVERSATION_NOT_FOUND", 404);

    await createMessage(tx, ctx.principalId, rawInput.conversationId, "user", rawInput.message);

    // Load history within same transaction
    const messages = await getMessages(tx, ctx.principalId, rawInput.conversationId);
    return messages.slice(-40).map(m => ({ role: m.role, content: m.content }));
  });
}

// src/server/commands/chat/save-assistant-message.ts
export async function handleSaveAssistantMessage(
  deps: { uow: UnitOfWork },
  input: { conversationId: string; content: string },
  ctx: AuthContext,
) {
  return deps.uow.run(ctx, async ({ db: tx }) => {
    await createMessage(tx, ctx.principalId, input.conversationId, "assistant", input.content);
  });
}
```

The stream route handler orchestrates these two commands + the LLM streaming I/O.

### 2.9 Remove `secureHandler` and `withTenantContext` from route handlers

After all routes are migrated, `secureHandler` can be deleted. `withTenantContext` is kept only for `withBootstrapContext` (used by `getOrCreateUser`). Consider renaming the file to `bootstrap-context.ts`.

### 2.10 Verify: remove `eq(userId)` from services

After confirming RLS with `current_tenant_id()` works correctly (tests pass), remove the redundant `eq(projects.userId, userId)` WHERE clauses from service functions. RLS handles row scoping. Services receive `tx` (which has RLS context) and don't need to filter by userId themselves.

**Do this one table at a time, running tests after each change.**

**Files created:** ~5 (uow types, drizzle-uow, migration)
**Files changed:** ~35 (all handlers, tenant.ts, make-deps.ts, route handlers)

---

## Phase 3: Authorization Policies (When Needed)

**Goal:** Extract authorization into explicit policy classes.

**Status:** Deferred — not needed yet.

**Trigger:** Implement when authorization grows beyond "user owns their own data."

**Current state is sufficient:** RLS enforces tenant isolation. Every row has `user_id`. Users can only access their own data. No sharing, no roles, no multi-tenancy beyond single-user scoping.

### Decision Guidance: When to implement Phase 3

**Do it when ANY of these become true:**
- Users need to share resources (e.g., shared projects, team workspaces)
- You add roles beyond "authenticated user" (admin, viewer, editor)
- You introduce organisation-level access (B2B multi-tenancy)
- Authorization logic starts appearing in service functions (sign that it needs its own layer)

**Don't do it if:**
- Every user only sees their own data (current state)
- You're adding new single-user features (just follow the existing pattern)
- You're tempted to add it "for future-proofing" — the handler layer already has the `deps` slot ready for policies, so adding them later is a ~20-file change, not a rewrite

**Cost of waiting:** Low. The handler signature `(deps, input, ctx)` already accepts policies via `deps`. Adding a policy class later is mechanical — create the class, add it to `makeDeps()`, call it from the handler before the UoW.

**Cost of doing it now:** Every handler gets a policy call that just returns `true`. You maintain empty policy classes that add cognitive overhead without preventing any real authorization bugs.

### 3.1 Policy classes (template for when needed)

```typescript
// src/server/policies/project-policy.ts
export class ProjectPolicy {
  async assertCanCreate(ctx: AuthContext) {
    // Currently: any authenticated user can create
    // Future: check org membership, subscription tier, etc.
  }

  async assertCanEdit(ctx: AuthContext, projectId: string, deps: { readOnly: ReadOnlyExecutor }) {
    // Currently: RLS handles it
    // Future: check team membership, collaborator role, etc.
  }
}
```

### 3.2 Wire into handlers

```typescript
// Command handler with policy
export async function handleUpdateProject(
  deps: { uow: UnitOfWork, policy: ProjectPolicy },
  rawInput: unknown,
  ctx: AuthContext,
) {
  const input = UpdateProjectInput.parse(rawInput);
  await deps.policy.assertCanEdit(ctx, input.projectId, deps);

  return deps.uow.run(ctx, async ({ db: tx }) => {
    return updateProject(tx, ctx.principalId, input.projectId, input);
  });
}
```

**Files created:** ~5 (policy classes)
**Files changed:** ~20 (handlers to inject policies)

---

## Phase 4: Supabase Realtime (Server-Side)

**Goal:** Enable real-time data updates using Supabase Realtime via server-side subscription pattern.

**Status:** Deferred — polling/refetch-on-focus is sufficient for current features.

**Prerequisite:** Phase 2 complete (RLS with `current_tenant_id()` working).

### Decision Guidance: When to implement Phase 4

**Do it when ANY of these become true:**
- Users complain about stale data or need to see updates without refreshing
- You build a collaborative feature where multiple users edit the same resource
- You add notifications that need to appear instantly (not on next page load)
- Chat-like features expand beyond the current single-user AI chat (e.g., team chat)

**Don't do it if:**
- TanStack Query's `refetchOnFocus` and `refetchOnWindowFocus` handle your use cases (they handle most single-user CRUD apps)
- You can solve the UX with optimistic updates (already implemented for projects)
- The "real-time" requirement is actually "refresh within 30 seconds" — use `refetchInterval` instead

**Cost of waiting:** Users see slightly stale data until they refocus the tab or navigate. For a single-user app this is rarely noticeable since the user is the only one making changes.

**Cost of doing it now:** You add Supabase client dependencies, manage SSE connections and reconnection logic, handle server-side channel subscriptions, and deal with Vercel's serverless connection limits — all for features that don't exist yet.

**Incremental alternative:** Add `refetchInterval: 30_000` to specific queries that benefit from near-real-time updates. This is 1 line per query vs an entire infrastructure layer.

### 4.1 Supabase server client

```typescript
// src/lib/supabase-server.ts
import { createClient } from "@supabase/supabase-js";

// Service role client — server-side only, bypasses RLS
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);
```

Add `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to `.env.local` and `.env.example`.

### 4.2 Server-side Realtime listener (optional pattern)

For features that need true push (e.g., collaborative editing, live notifications):

```typescript
// src/lib/realtime/channel-manager.ts
// Manages per-user SSE connections
// Subscribes to postgres_changes via supabaseAdmin
// Filters events by user_id before pushing to the correct SSE connection
```

### 4.3 Client-side: TanStack Query refetch pattern

For most use cases, polling or refetch-on-focus is sufficient:

```typescript
// Polling for near-real-time updates
useQuery({
  queryKey: ["meetings"],
  queryFn: () => api.listMeetings(),
  refetchInterval: 30_000, // 30 seconds
});
```

### 4.4 Client-side: SSE subscription hook (for chat-like features)

Extend the existing `useStreamChat` pattern for other real-time features:

```typescript
// src/hooks/use-realtime-updates.ts
export function useRealtimeUpdates(resource: string, id: string) {
  // SSE connection to /api/realtime/subscribe?resource=meetings&id=...
  // Server validates auth, subscribes via supabaseAdmin, proxies events
}
```

**Files created:** ~4
**Files changed:** ~3

---

## Phase 5: Contracts and Validation Hardening

**Goal:** Separate Zod schemas by purpose. Validate responses.

**Status:** Deferred — API surface is still evolving.

### Decision Guidance: When to implement Phase 5

**Do it when ANY of these become true:**
- You start building a React Native app or other external API consumer that needs a stable contract
- You open the API to third parties who need documented request/response shapes
- You accidentally expose sensitive fields in an API response (response validation would have caught it)
- The API surface stabilises — you're no longer adding new entities or changing response shapes weekly

**Don't do it if:**
- You're the only consumer and TanStack Query hooks are tightly coupled to the API anyway
- You're still adding features and the response shapes are changing (you'd be writing response schemas for shapes that change next week)
- Input validation is your main concern — the handler layer already has Zod input schemas covering the highest-risk direction (user input)

**Cost of waiting:** If you accidentally return a field you shouldn't (e.g., internal ID, hashed password), you won't catch it until someone notices. Mitigate by being careful about what services return (use Drizzle column selection, not `select *`).

**Cost of doing it now:** Every new feature requires schemas in 3 places (request, response, shared) instead of 1. Response schemas need updating every time the shape changes. This friction is worthwhile when the API is stable and has external consumers — it's overhead when you're iterating fast on a solo project.

### 5.1 Shared schemas directory

```
src/shared/
  schemas/
    projects.ts      # CreateProjectRequest, ProjectResponse, etc.
    chat.ts
    meetings.ts
    users.ts
    pagination.ts    # CursorParams, OffsetParams
  errors/
    error-envelope.ts
```

### 5.2 Schema separation

Each domain gets request, response, and internal schemas:

```typescript
// src/shared/schemas/projects.ts
export const CreateProjectRequest = z.object({ ... });
export const ProjectResponse = z.object({ ... });
export const ProjectListResponse = z.object({
  projects: z.array(ProjectResponse),
  total: z.number(),
});
```

### 5.3 Response validation

Parse responses with Zod before returning from API routes:

```typescript
// In route handler
const result = await handleListProjects(makeDeps(), params, ctx);
return Response.json(ProjectListResponse.parse(result));
```

This catches accidental field exposure (e.g., leaking internal IDs or sensitive fields).

**Files created:** ~8
**Files changed:** ~16

---

## Phase 6: Operational Hardening (Future — Triggered by Requirements)

**Status:** Deferred — each sub-item is independent and triggered by a specific need.

Defer until triggered. Document as ready-to-implement when needed.

### 6.1 Trace IDs
- Generate UUID trace ID in `requireAuthContext`
- Pass through `AuthContext` or separate parameter
- Include in error envelope and structured logs

**When to do it:** You're debugging production issues and can't correlate a user's error report with server logs. Or you're integrating with external services (payment, email) and need to trace a request across systems.

**Not yet because:** `console.error` in `handleAppError` is sufficient when you're the only developer and can reproduce issues locally. Trace IDs add value when you can't reproduce the user's exact request.

### 6.2 Structured logger
- Replace `console.log`/`console.error` with structured logger
- JSON in production, human-readable in dev
- PII redaction rules

**When to do it:** You deploy to production and need to search/filter logs in a log aggregator (CloudWatch, Datadog, etc.). Or you need PII redaction for compliance (GDPR, health data).

**Not yet because:** During development, `console.log` is perfectly readable. Structured logging adds a dependency and configuration overhead that only pays off when you're parsing logs programmatically.

### 6.3 Outbox + Worker
- Create outbox table (migration from Phase 2 deferred design)
- Add `outbox` to `TransactionContext`
- Worker: Supabase Edge Function, Vercel Cron, or AWS Lambda
- Dead-letter queue for exhausted retries

**When to do it:** You need a side effect that must happen reliably after a mutation but shouldn't block the response. Examples: send an email after account creation, sync data to an external system, trigger a background job after a meeting is created.

**Not yet because:** An outbox without a worker just accumulates unprocessed rows. No current feature needs async side effects. If you add a simple side effect (e.g., sending an email), start with a direct call in the handler and only move to outbox when reliability or decoupling becomes important.

### 6.4 Idempotency
- Create idempotency table
- Add `idempotency` to `TransactionContext`
- Support `Idempotency-Key` header in route handlers

**When to do it:** You build a mobile app where network reliability is poor and requests may be retried. Or you accept webhooks from external services that may deliver duplicates. Or you process payments where double-charging is unacceptable.

**Not yet because:** Web browsers don't retry POST requests on their own. TanStack Query mutations have built-in deduplication. The risk of duplicate operations in a single-user web app is near zero.

### 6.5 API versioning
- Add `/api/v1/` route prefix
- Keep current routes as aliases initially

**When to do it:** You ship a mobile app to the App Store. Once users have a binary on their phone, you can't change the API contract without breaking their app. Versioning lets you evolve the API while old clients keep working.

**Not yet because:** Your only client is the Next.js frontend, deployed alongside the API. They always match. Versioning a single-deployment web app adds routing complexity with no benefit.

### 6.6 CI fitness functions
- No `next/*` or `react` imports in `server/` directory
- Route handler line count < 60
- No direct `db.` calls in handlers (must go through UoW or ReadOnly)

**When to do it:** The team grows beyond 1-2 developers and you need automated guardrails to prevent architectural drift. Or you find yourself repeatedly catching the same pattern violations in code review.

**Not yet because:** You can enforce these conventions manually when you're the only developer. The rules are documented in this plan and in CLAUDE.md. CI checks add maintenance overhead (custom ESLint rules or scripts) that isn't justified until the team scales.

---

## Implementation Order and Dependencies

```
Phase 0 (Tests)          ✅ DONE (2026-03-07). 75 tests across 9 files.
  |
Phase 1 (Foundation)     ✅ DONE (2026-03-08). All routes migrated to requireAuthContext + handlers.
  |
Phase 2 (Transactions)   ✅ DONE (2026-03-08). UoW, ReadOnly, migration 007, RLS rename.
  |
  |── Phase 3 (Policies)       ✅ DONE (2026-03-08). Noop policies as extension point.
  |                             📝 NOTE: Orphaned project/meeting/chat policies removed 2026-03-11
  |                                      after domain pivot. Pattern preserved in user/session handlers.
  |
  |── Phase 4 (Realtime)       ⏳ DEFERRED. See docs/dev-notes/deferred-architecture-items.md
  |
  |── Phase 5 (Contracts)      ✅ PARTIAL. API versioning (6.5) done. Response schemas deferred.
  |
  └── Phase 6 (Hardening)      ✅ PARTIAL. Sub-items:
       ├── 6.1 Trace IDs           ✅ DONE — traceId in AuthContext + error envelope
       ├── 6.2 Structured logger   ✅ DONE — src/lib/logger.ts (JSON prod, readable dev)
       ├── 6.3 Outbox + Worker     ⏳ DEFERRED. See docs/dev-notes/deferred-architecture-items.md
       ├── 6.4 Idempotency         ⏳ DEFERRED. See docs/dev-notes/deferred-architecture-items.md
       ├── 6.5 API versioning      ✅ DONE — /api/v1/ routes + rewrites
       └── 6.6 CI fitness          ⏳ DEFERRED. See docs/dev-notes/deferred-architecture-items.md
```

## File Impact Summary

| Phase | New Files | Changed Files | Risk |
|---|---|---|---|
| 0 (Tests) | ~6 | 1 | Low |
| 1 (Foundation) | ~30 | ~16 | Low (incremental) |
| 2 (Transactions) | ~5 | ~35 | Medium (RLS rename) |
| 3 (Policies) | ~5 | ~20 | Low (deferred) |
| 4 (Realtime) | ~4 | ~3 | Low |
| 5 (Contracts) | ~8 | ~16 | Low |
| 6 (Hardening) | TBD | TBD | Low (deferred) |

## Non-Negotiable Rules (Adapted for Current Scale)

1. Every mutation goes through a command handler. Every read through a query handler.
2. Every write runs inside a UnitOfWork that injects `AuthContext` via `SET LOCAL`.
3. Read queries inject `AuthContext` via a read-only transaction wrapper.
4. Transport code delegates to handlers — no business logic in route files.
5. Business logic in `src/server/` never imports `next/*` or `react`.
6. `withBootstrapContext` is the only exception to identity injection (documented).
7. Chat stream route is the only exception to thin route handlers (documented).
8. RLS is the hard backstop. Policies are business-level authorization.
9. Outbox, idempotency, and workers are added when triggered by requirements, not speculatively.
10. Tests must pass before and after every phase transition.

## Checklist for New Features (Post-Migration)

- [ ] Command or query handler created in `src/server/commands/` or `src/server/queries/`
- [ ] Handler accepts `(deps, rawInput, ctx)` — no framework imports
- [ ] Zod schema defined for input
- [ ] Write path uses `deps.uow.run(ctx, ...)` with `SET LOCAL` (automatic via UoW)
- [ ] Read path uses `deps.readOnly.run(ctx, ...)` with `SET LOCAL` (automatic via ReadOnly)
- [ ] Route handler is thin: `requireAuthContext` -> parse -> call handler -> return
- [ ] TanStack Query hook wraps `apiFetch`
- [ ] Database RLS policy exists for any new tables (using `current_tenant_id()`)
- [ ] Tests cover handler logic and schema validation
- [ ] (When applicable) Policy check called before UoW
- [ ] (When applicable) Outbox used for async side effects
