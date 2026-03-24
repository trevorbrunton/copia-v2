# App Architecture

> **Note (2026-03-22):** Code examples reference "projects" as an illustrative domain. The patterns apply to all apps built on this architecture. See `docs/architecture/architecture.md` for the current MyAgency system overview.
>
> **MyAgency implementation status (2026-03-22):** Phase 1 (route migration: 140/157 routes) and Phase 2 (outbox wiring: 5 commands + feature flag + RLS) are complete. See `docs/plans/architecture-compliance-remediation-plan.md` for details.

_A plain-language architecture reference with annotated code samples and pragmatic guardrails._

Stack: Next.js • Expo • TypeScript • Zod • Drizzle • TanStack Query • AWS • Supabase

---

## How to Use This Guide

1. **New to the stack?** Read the concept blurbs first, then inspect the code blocks.
2. **Need implementation details?** Jump directly to the code fence and the "What it means" tables.
3. **Working on a tiny feature?** See ["Choosing a Path"](#choosing-a-path-standard-vs-lightweight) for approved lighter flows that still honour the architecture.
4. **Unsure whether something is optional or mandatory?** The ["Guardrails"](#architecture-guardrails) section labels every rule as `Required`, `Conditional`, or `Optional`.

> 💡 Every code sample references real files in this repo. Use the file paths to open the implementation in your editor for deeper context.

### Canonical Names vs. Current Implementation

This guide serves two audiences:

1. **Today’s Mayfly repo (`mayfly-starter`)** — a concrete reference implementation.
2. **Future sibling apps (e.g., `myagency`)** — projects that should follow the same architectural contracts even if their codebases are brand new.

Therefore:

- When a function/class already exists in this repo, the guide uses its exact name (`handleCreateProject`, `makeDeps`, etc.).
- When an abstraction is still on the roadmap (e.g., `ProjectPolicy`, Outbox writer, worker CLI), the guide spells out the _canonical_ name and tags it with a 📌 note so teams can align as they implement it.

Keep the names consistent even if your app hasn’t implemented the piece yet; it prevents drift between teams and makes the upgrade path obvious.

---

## The Core Principle

Business logic lives in the **Application Layer** (command/query handlers). UI components, API routes, and SQL files stay thin and declarative.

### The Seven-Step Request Pipeline

| Step | What happens |
| --- | --- |
| 1. Receive the request | Route handler or Server Action accepts an HTTP request, RPC call, or React form submission. |
| 2. Validate input | Zod schemas confirm the payload shape before anything else executes. |
| 3. Resolve identity | `requireAuthContext()` produces a canonical `AuthContext`. Anonymous requests stop here. |
| 4. Run business logic | Command/query handler enforces policies, domain rules, and unit-of-work orchestration. |
| 5. Check permissions | Policy classes answer resource-aware questions (role + record). |
| 6. Persist & queue side effects | Writes execute inside a Unit of Work. Async work is recorded in the Outbox. |
| 7. Return a response | Handlers return DTOs that get validated and serialized back to the transport. |

**Most important rule:** _If business logic shows up in a route handler, React component, SQL file, or TanStack hook, move it back into a handler._

---

## Data Journeys

### 1. Mutations (Commands)

```
Request → Route/Action → Zod validation → Command handler
        → Unit of Work (tx) → Repos → Outbox/Idempotency
        → DTO response → Transport serialises JSON
```

### 2. Reads (Queries)

```
Request → Route/Server Component → Zod validation → Query handler
        → Read-only executor → Query services / SQL / cache
        → DTO response → Transport serialises JSON
```

### 3. Async Side Effects

```
Command handler saves primary record + outbox event in same tx
Worker polls pending outbox rows → executes action (email, webhook, indexing)
Worker marks success or schedules retry with exponential backoff
```

---

## Layer Model with Code

```
┌────────────────────────────────────────────────────────┐
│ Transport (Next.js routes, Server Actions, Expo RPC)   │
│ - Parse HTTP/form input                                │
│ - Call handlers                                        │
│ - Map errors to HTTP                                   │
├────────────────────────────────────────────────────────┤
│ Application (handlers, policies, DTO builders)         │
│ - Validate input                                       │
│ - Apply business rules & policies                      │
│ - Coordinate transactions and outbox writes            │
├────────────────────────────────────────────────────────┤
│ Data (services, repositories, query services)          │
│ - Pure DB/search/cache access                          │
│ - No framework imports                                 │
├────────────────────────────────────────────────────────┤
│ Infrastructure (Drizzle, PostgreSQL, queues, workers)  │
└────────────────────────────────────────────────────────┘
```

### Transport Example — Route Handler

_File: `app/api/projects/route.ts`_

```ts
import { requireAuthContext } from "@/src/server/require-auth-context";
import { handleCreateProject } from "@/src/server/commands/projects/create-project";
import { handleListProjects } from "@/src/server/queries/projects/list-projects";
import { handleAppError } from "@/src/server/errors";
import { makeDeps } from "@/src/server/make-deps";

export async function POST(req: Request) {
  try {
    const ctx = await requireAuthContext(req);
    const body = await req.json();
    const result = await handleCreateProject(makeDeps(), body, ctx);
    return Response.json(result, { status: 201 });
  } catch (err) {
    return handleAppError(err);
  }
}
```

| Code | What it means |
| --- | --- |
| `requireAuthContext(req)` | Normalises headers/cookies/tokens into a single `AuthContext`. Rejects anonymous requests early. |
| `await req.json()` | Pulls raw JSON without trusting its shape. |
| `handleCreateProject(makeDeps(), body, ctx)` | Hands off work to the command handler with dependencies produced by `makeDeps()`. |
| `handleAppError(err)` | Standard error envelope + status mapping. |

> ✅ **Guardrail:** Route handlers stay under ~40 LOC. If they grow larger, extract the logic into a handler.

#### Current Migration State (MyAgency)

In MyAgency, 140 of 157 routes use `secureHandler` (a legacy wrapper) with a bridge function instead of `requireAuthContext` directly:

```ts
export const POST = secureHandler(async (request, _tx, secureCtx) => {
  const traceId = crypto.randomUUID();
  try {
    const ctx = fromSecureContext(secureCtx, traceId);  // Bridge to AuthContext
    const body = await request.json();
    const result = await handleCreateEntity(makeDeps(), body, ctx);
    return Response.json(result, { status: 201 });
  } catch (err) {
    return handleAppError(err, traceId);
  }
});
```

`fromSecureContext(sc, traceId)` maps `sc.userId` → `ctx.principalId`. The `secureHandler` wrapper provides JWT validation and RLS context. UoW/ReadOnly executors independently set RLS as defense-in-depth. 17 routes are documented architectural exceptions (OAuth, SSE streaming, internal handlers, entity factory routes).

### Server Action Example (web-only forms)

_File: `app/projects/actions.ts`_ (📌 add when you build form submissions)

```ts
"use server";
import { requireSessionUser } from "@/src/server/require-auth-context";
import { handleCreateProject } from "@/src/server/commands/projects/create-project";
import { makeDeps } from "@/src/server/make-deps";

export async function createProjectAction(formData: FormData) {
  const ctx = await requireSessionUser();
  return handleCreateProject(
    makeDeps(),
    {
      name: formData.get("name"),
      description: formData.get("description"),
      status: formData.get("status"),
    },
    ctx,
  );
}
```

Same flow, different transport. 📌 _Implementation status:_ Mayfly currently uses API routes only. When you introduce Server Actions, mirror this blueprint.

### Command Handler Anatomy

_File: `src/server/commands/projects/create-project.ts`_

Step 1 — Input schema

```ts
import { z } from "zod";
export const CreateProjectInput = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  status: z.enum(["active", "draft", "completed", "archived"]).optional(),
  idempotencyKey: z.string().max(100).optional(),
});
```

Step 2 — Dependencies and signature

```ts
type Deps = {
  uow: UnitOfWork;
  projectRepo: ProjectRepository;
  projectPolicy: ProjectPolicy;
  outbox: OutboxWriter;
  idempotency: IdempotencyStore;
};

export async function handleCreateProject(
  deps: Deps,
  rawInput: unknown,
  ctx: AuthContext,
) {
  const input = CreateProjectInput.parse(rawInput);
  await deps.projectPolicy.assertCanCreate(ctx, input.status ?? "active");
```

Step 3 — Transaction body

```ts
  return deps.uow.run(ctx, async (tx) => {
    if (input.idempotencyKey) {
      const cached = await deps.idempotency.get(tx, input.idempotencyKey);
      if (cached) return cached;
    }

    const duplicate = await deps.projectRepo.findByName(tx, {
      ownerId: ctx.principalId,
      name: input.name,
    });
    if (duplicate) throw new ConflictError("Project already exists");

    const record = await deps.projectRepo.create(tx, {
      ...input,
      createdBy: ctx.principalId,
    });

    await deps.outbox.enqueue(tx, {
      type: "project.created",
      aggregateId: record.id,
      payload: { projectId: record.id, ownerId: ctx.principalId },
      traceId: ctx.traceId,
    });

    const result = {
      id: record.id,
      name: record.name,
      createdAt: record.createdAt.toISOString(),
    };

    if (input.idempotencyKey) {
      await deps.idempotency.put(tx, input.idempotencyKey, result);
    }

    return result;
  });
}
```

> 📌 _Implementation status:_ In `mayfly-starter`, `handleCreateProject` currently only depends on `{ uow }` plus service functions. Treat the snippet above as the canonical contract when you introduce repositories, policies, idempotency, and the outbox.

### Query Handler Anatomy

_File: `src/server/queries/projects/list-projects.ts`_

```ts
import { z } from "zod";

export const ListProjectsInput = z.object({
  search: z.string().optional(),
  status: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export async function handleListProjects(
  deps: { readOnly: ReadOnlyExecutor; projectPolicy: ProjectPolicy; projectQueries: ProjectQueryService },
  rawInput: unknown,
  ctx: AuthContext,
) {
  const input = ListProjectsInput.parse(rawInput);
  await deps.projectPolicy.assertCanList(ctx, ctx.orgId);

  const rows = await deps.readOnly.run(ctx, (tx) =>
    deps.projectQueries.list(tx, input),
  );

  return {
    items: rows.items.map(toProjectDTO),
    cursor: rows.nextCursor,
  };
}

> 📌 _Implementation status:_ The current query handler already follows this structure but does not yet depend on `projectPolicy` or `projectQueries`. Add them when you break read paths away from shared services.
```

### Policy Example

_File: `src/server/policies/project-policy.ts`_ (📌 add alongside Tier A features)

```ts
export class ProjectPolicy {
  async assertCanCreate(ctx: AuthContext) {
    if (!ctx.roles.includes("project:write")) throw new ForbiddenError();
  }

  async assertCanView(ctx: AuthContext, record: Project) {
    if (record.userId !== ctx.principalId) throw new NotFoundError();
  }
}
```

📌 _Implementation status:_ Policies are currently embedded inside services. Move them into dedicated classes as soon as you add multi-tenant or role-aware behaviour.

### Composition Root

_File: `src/server/make-deps.ts`_

```ts
export function makeDeps(): AppDeps {
  return {
    uow: new DrizzleUnitOfWork(db),
    readOnly: new DrizzleReadOnly(db),
    projectRepo: new DrizzleProjectRepository(db),
    projectQueries: new DrizzleProjectQueryService(db),
    projectPolicy: new ProjectPolicy(),
    outbox: new DrizzleOutboxWriter(db),
    idempotency: new DrizzleIdempotencyStore(db),
  };
}
```

Tests use `makeTestDeps()` with fakes (in-memory repos, noop outbox) for millisecond feedback.

📌 _Implementation status:_ The starter today wires only `{ uow, readOnly }`. As you add Tier A flows, extend `makeDeps()` to return the rest of the canonical dependencies.

---

## Validation & Contracts

- **Request schemas** guard incoming payloads.
- **Response schemas** guarantee what leaves the server.
- **Event payload schemas** define outbox messages.
- **Shared contracts** live in `packages/contracts` so web, mobile, and backend stay in sync.

```ts
// packages/contracts/src/api/projects.ts
export const CreateProjectRequest = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  status: z.enum(["active", "draft", "completed", "archived"]).optional(),
  idempotencyKey: z.string().max(100).optional(),
});

export const ProjectResponse = z.object({
  id: z.string().uuid(),
  name: z.string(),
  status: z.string(),
  createdAt: z.string().datetime(),
});
```

Use `z.infer<typeof Schema>` to derive TypeScript types—never duplicate them manually.

---

## Authorization Model

### AuthContext

_File: `src/server/auth-context.ts`_

```ts
export type AuthContext = {
  principalId: string;
  orgId?: string;
  sessionId?: string;
  roles: string[];
  scopes: string[];
  memberships: Array<{
    resourceType: string;
    resourceId: string;
    role: string;
  }>;
  traceId: string;
};
```

### Policy Rules of Thumb

| Bad pattern | Better replacement |
| --- | --- |
| `if (!ctx.roles.includes("admin")) throw` in handlers | `await projectPolicy.assertCanCreate(ctx)` |
| Checking only roles | Check role **and** the specific record/org. |
| Returning 403 for cross-tenant data | Return 404 to hide record existence. |

---

## Unit of Work, Outbox, and Idempotency

### Unit of Work Interface

```ts
// src/server/uow/types.ts
export interface UnitOfWork {
  run<T>(ctx: AuthContext, fn: (tx: TransactionContext) => Promise<T>): Promise<T>;
}

export interface TransactionContext {
  db: DrizzleTransaction;
}
```

All writes happen inside a UoW. The implementation also:

- Sets `request.jwt.claims` so Supabase RLS can use `auth.uid()`.
- Shares the same transaction handle with the outbox writer and idempotency store.

### Outbox Table

```sql
CREATE TABLE outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,                              -- Tenant ID for RLS isolation
  aggregate_type TEXT NOT NULL,
  aggregate_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempt_count INT NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending',
  idempotency_key TEXT,
  trace_id TEXT
);

-- RLS: tenant isolation on outbox events
ALTER TABLE outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbox FORCE ROW LEVEL SECURITY;
CREATE POLICY outbox_tenant_isolation ON outbox
  USING (current_setting('app.tenant_id', true) = user_id::text);

CREATE INDEX idx_outbox_pending ON outbox (next_attempt_at) WHERE status = 'pending';
CREATE INDEX idx_outbox_aggregate ON outbox (aggregate_type, aggregate_id);
CREATE INDEX idx_outbox_user_pending ON outbox (user_id, status) WHERE status = 'pending';
```

**MyAgency implementation status (2026-03-22):** Outbox table created (migration 090 + 092 for RLS hardening). 5 command handlers wired: `create-entity` → `entity.created.v1`, `update-entity` → `entity.updated.v1`, `delete-entity` → `entity.deleted.v1`, `trigger-sync` → `sync.completed.v1`, `create-invitation` → `invitation.created.v1`. All gated by `OUTBOX_ENABLED` feature flag (default: off). Outbox worker Lambda not yet deployed — events accumulate safely when flag is off.

### Worker Lifecycle

1. Worker polls `pending` rows where `next_attempt_at <= now()`.
2. Marks the row `processing` with `FOR UPDATE SKIP LOCKED` to avoid duplicate work.
3. Loads any extra data and executes the action (webhook, email, indexing, etc.).
4. On success ⇒ set status `completed`, record `attempt_count`.
5. On failure ⇒ increment `attempt_count`, set `next_attempt_at` using exponential backoff.
6. After N failures (default 10) ⇒ mark `dead-lettered` and emit alert.

### Operational Guardrails

- **Idempotency:** Workers must handle duplicate deliveries. Keep a hash of side-effect inputs or check `idempotency_key` when calling third parties.
- **Metrics:** Emit `outbox.pending`, `outbox.failures`, `outbox.lag_ms`, and `worker.heartbeat`. Alert when lag > 5 minutes or failure rate > 5%.
- **Replay tooling:** CLI `bun run scripts/replay-outbox <eventId>` requeues stalled events safely.
- **Tracing:** Copy the request `traceId` into the outbox row so logs can be correlated end-to-end.

📌 _Implementation status (MyAgency):_ Outbox wiring complete for 5 critical commands. Worker deployment deferred to next CDK sprint. When `OUTBOX_ENABLED=false` (default), commands execute side effects directly. When `true`, events are written transactionally to the outbox table within the UoW. The `userId` column ensures RLS isolation for the future worker.

---

## Observability

1. **Request tracing:** `requireAuthContext()` generates a UUIDv7 `traceId`. Pass it through handlers, logs, metrics, and outbox payloads.
2. **Structured logging:** Use `logger.info({ traceId, route, latencyMs, ... })`. Never log raw PII.
3. **Metrics:**
   - Transport: request duration, error rate, auth failures.
   - Handlers: command success/failure counts, retries triggered.
   - Workers: queue depth, per-event latency, DLQ count.
4. **Log correlation:** Every error response includes `traceId` inside the API error envelope so support can cross-reference logs quickly.

📌 _Implementation status:_ Basic `console.*` calls exist today. Replace them with a structured logger (Pino/Winston) as soon as you introduce production observability so the trace IDs and metrics above become real data instead of TODOs.

---

## API Design & Error Envelope

```ts
// src/server/errors.ts
export function handleAppError(err: unknown) {
  if (err instanceof ForbiddenError) {
    return Response.json({ error: { code: "FORBIDDEN", message: err.message, traceId: err.traceId } }, { status: 403 });
  }
  // ...other mappings
}
```

Status mapping cheatsheet:

| Status | Meaning |
| --- | --- |
| 400 / 422 | Invalid input (Zod validation) |
| 401 | Not authenticated |
| 403 | Authenticated but not allowed |
| 404 | Not found / hidden for tenant safety |
| 409 | Conflict (duplicates, stale versions) |
| 429 | Rate limited |
| 500 | Unexpected server error |

---

## Multi-Client Data Access

### Typed API Client (web + mobile)

```ts
// packages/api-client/src/projects.ts
export async function createProject(input: unknown, token: string) {
  const body = CreateProjectRequest.parse(input);
  const res = await fetch(`${BASE_URL}/api/projects`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(res.status, await res.text());
  return ProjectResponse.parse(await res.json());
}
```

### TanStack Query Hooks

```ts
// hooks/useProjects.ts
export function useProjects() {
  return useQuery({
    queryKey: ["projects"],
    queryFn: () => api.listProjects(),
  });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.createProject,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });
}
```

TanStack query keys map 1:1 with handler DTOs. Hooks never call `fetch` directly—only the typed API client.

---

## Choosing a Path: Standard vs Lightweight

Not every feature needs the full ceremony. Use the table below to pick the correct path.

| Path | Use it when | Includes | Skips |
| --- | --- | --- | --- |
| **Tier A — Durable Flow** | Multi-tenant data, money movement, anything mobile/partner clients call, async side effects, compliance-sensitive domains. | Command/query handlers, Unit of Work, outbox, idempotency store, policy checks, typed contracts, CI guardrails. | Nothing. This is the default expectation. |
| **Tier B — Lightweight Flow** | Internal-only CRUD, prototypes behind feature flags, read-mostly admin pages without async work. Must be reversible and low blast radius. | AuthContext resolution, Zod validation, policy check (even if simple), Unit of Work for writes, DTO responses. | Can skip idempotency keys, outbox, and typed TanStack hook if the flow stays web-only. Async work must still funnel through a worker later before GA. |

**Promotion rule:** If a Tier B feature ships to customers, gains async side effects, or needs mobile access, upgrade it to Tier A before releasing.

---

## Architecture Guardrails

| Rule | Rationale | Level |
| --- | --- | --- |
| Business logic lives in handlers, not routes/components | Keeps framework noise away from domain rules | Required |
| Every write uses the Unit of Work | Ensures atomicity, consistent tracing, RLS claims | Required |
| Outbox is the only path for async effects | Prevents ghost writes when servers crash | Required for Tier A, Conditional for Tier B |
| Route handlers under 40 lines | Signals logic leakage | Required |
| Policies enforce authorization | Resource-aware checks, easy auditing | Required |
| Shared Zod contracts for API client + server | Prevents drift across clients | Required when API is shared (web+mobile/partners) |
| Idempotency keys on retry-prone commands | Makes retries safe | Required for external clients, Optional for internal-only Tier B |
| Observability (traceId, structured logs) | Enables diagnosis and on-call response | Required |
| TanStack hooks wrap the API client | Unified caching and error handling | Required on shared hooks, Optional for static pages |
| Workers must handle duplicate delivery | Guarantees exactly-once semantics | Required |

---

## Testing Strategy

| Layer | What to test | Dependencies |
| --- | --- | --- |
| Policies / domain rules | Happy + unhappy authorization paths | Pure functions |
| Command handlers | Validation, policies, transaction orchestration, outbox writes | Fake repos, fake UoW, spy outbox |
| Query handlers | Filter logic, DTO mapping, pagination | Fake query services or read-only DB |
| Repositories/services | SQL correctness, constraints | Test database |
| Contracts | Schema compatibility snapshots | Zod tests |
| Transport | Request parsing, status mapping | Mock handlers |
| Workers | Retry math, duplicate detection, DLQ paths | Fake outbox + fake third parties |
| End-to-end | Auth, critical CRUD, async effect fan-out | Full stack |

---

## Decision Guides

### Server Components vs TanStack Query

| Use Server Components for… | Use TanStack Query for… |
| --- | --- |
| Initial page load / SSR, SEO-sensitive content, data that never mutates client-side | Interactive dashboards, optimistic updates, shared caches across components, anything requiring retry/invalidation |

### Server Actions vs Route Handlers

| Server Actions | Route Handlers |
| --- | --- |
| Web-only form submissions, internal admin tools | Anything mobile/partner clients call, versioned public APIs, webhooks, CLI consumers |

### Repository vs Query Service

| Repository | Query Service |
| --- | --- |
| Transactional writes, aggregates with invariants, ORM-agnostic domain | Read-only, performance-sensitive views, joins across stores, Search/Elastic |

---

## Async Worker Details

- **Deployment:** Workers run as Bun processes (or AWS Lambda) reading from the same Postgres database. Use `RUN_AT_MOST_EVERY=5s` cron or queue triggers.
- **Configuration:** Environment variables specify batch size, max attempts, and webhook credentials. All env access goes through `src/lib/config.ts` so incorrect deployments fail fast.
- **Duplicate safety:** Workers keep a `processed_events` table keyed by `(event_type, aggregate_id, payload_hash)` to ensure exactly-once semantics when third parties lack idempotent APIs.
- **Alerting:**
  - Pager when `outbox.pending` exceeds 5,000 rows or `worker.heartbeat` missing for 2 intervals.
  - Slack notifications for events entering DLQ with payload preview.

### Long-Running & Batch Workloads (GraphRAG, analytics, etc.)

Some myAgency-style features require heavy processing (GraphRAG enrichment, nightly rollups, ML pipelines). Treat them as downstream consumers of the durable signals above rather than shoving the work into the interactive request cycle.

1. **Triggering:** Tier A commands emit canonical events (outbox table, Kafka, Supabase replication slot). A dedicated “batch orchestrator” service subscribes to those events or to a derived queue.
2. **Orchestration:** The batch worker pulls jobs in chunks, persists checkpoints (`graphrag_jobs`, `last_cursor`), and fans out into whatever compute fabric you need (Step Functions, ECS, Databricks). This layer is free to buffer aggressively because durability is already guaranteed upstream.
3. **Retries & SLA:** Batch processors own their own retry/backoff logic; they should never hold up the interactive outbox worker. Monitor throughput (`jobs_processed_per_minute`), lag (`event_age_ms`), and success/failure counts separately from the core queue metrics.
4. **Data contracts:** Publish versioned payload schemas for batch consumers (e.g., `GraphRagDocumentPayload v1`). When the processor needs new fields, evolve the schema just like any other contract.
5. **Back-pressure:** If the GraphRAG pipeline falls behind, pause or rate-limit new high-cost events by adding feature flags around the originating command or by throttling the orchestrator—not by skipping the outbox write.

📌 _Implementation status:_ Mayfly doesn’t run heavy batch jobs yet. MyAgency does—so lift these rules into that repo’s architecture doc verbatim and wire the batch system to consume the canonical events rather than inventing a parallel signalling mechanism.

---

## New Feature Checklist

1. [ ] Choose Tier A or Tier B path and note it in the PR description.
2. [ ] Handler created under `server/commands` or `server/queries`.
3. [ ] Handler signature is `(deps, rawInput, ctx)` with no framework imports.
4. [ ] Request and response Zod schemas exist (and live in `contracts` if shared).
5. [ ] Policy function enforces authorization.
6. [ ] Unit of Work wraps all writes; read handlers use `readOnly` executor.
7. [ ] Outbox + idempotency wired up when required.
8. [ ] Route handler stays under 40 lines and simply calls the handler.
9. [ ] TanStack hook (or Server Component) uses the typed API client when UI needs it.
10. [ ] `traceId` flows from transport through logs/outbox/errors.
11. [ ] Tests cover happy/sad paths for validation, policies, handlers, and schemas.
12. [ ] Observability: log message + metric for the new command/query + worker instrumentation if applicable.

Tick everything before marking the feature as done. If a box cannot be checked, explain why in the PR and agree on a follow-up item.

---

## Appendix: Reference Tables

### Error Codes

| Code | When to use |
| --- | --- |
| `UNAUTHORIZED` | No or invalid credentials |
| `FORBIDDEN` | Policy rejected access |
| `NOT_FOUND` | Resource missing or belongs to another tenant |
| `CONFLICT` | Duplicate data, stale version, concurrent update |
| `VALIDATION_ERROR` | Zod schema failed |
| `RATE_LIMITED` | Upstream or internal limiter triggered |
| `INTERNAL_ERROR` | Unexpected failures |

### Metrics Minimums

| Metric | Description |
| --- | --- |
| `http.server.duration` | Duration per route + status |
| `command.success` / `command.failure` | Per handler outcome |
| `outbox.pending` | Queue depth |
| `worker.retry` | Count of retries per event type |
| `tanstack.cache.hit_ratio` | Client cache health |

These metrics plus logs/traces make on-call response viable and satisfy the "Observability from day one" non-negotiable.

---

## Appendix: Worked Example — Document Upload + GraphRAG Pipeline

Use case: “Upload a document to S3, kick off GraphRAG processing asynchronously, render thumbnails, optimistically update the Documents page, and reconcile when processing completes.”

### 1. Transport Layer (API Route)

_File: `app/api/documents/route.ts`_

```ts
import { requireAuthContext } from "@/src/server/require-auth-context";
import { handleUploadDocument } from "@/src/server/commands/documents/upload-document";
import { handleListDocuments } from "@/src/server/queries/documents/list-documents";
import { handleAppError } from "@/src/server/errors";
import { makeDeps } from "@/src/server/make-deps";

export async function POST(req: Request) {
  try {
    const ctx = await requireAuthContext(req);
    const body = await req.json();
    const result = await handleUploadDocument(makeDeps(), body, ctx);
    return Response.json(result, { status: 202 });
  } catch (err) {
    return handleAppError(err);
  }
}
```

### 2. Command Handler

_File: `src/server/commands/documents/upload-document.ts`_ (📌 add during implementation)

```ts
export async function handleUploadDocument(
  deps: DocumentDeps,
  rawInput: unknown,
  ctx: AuthContext,
) {
  const input = UploadDocumentInput.parse(rawInput);
  await deps.documentPolicy.assertCanUpload(ctx, input.folderId);

  return deps.uow.run(ctx, async (tx) => {
    const doc = await deps.documentRepo.create(tx, {
      ownerId: ctx.principalId,
      name: input.name,
      s3Key: input.s3Key,
      status: "processing",
      sizeBytes: input.sizeBytes,
    });

    await deps.outbox.enqueue(tx, {
      type: "document.uploaded",
      aggregateId: doc.id,
      payload: {
        documentId: doc.id,
        s3Key: doc.s3Key,
        requiresGraphRag: input.enableGraphRag,
      },
      traceId: ctx.traceId,
    });

    return {
      id: doc.id,
      presignedUrl: await deps.storage.signUploadUrl(input.s3Key),
      status: doc.status,
    };
  });
}
```

### 3. Client Flow

- `useUploadDocument` TanStack mutation invokes the API client.
- On success, the hook writes an optimistic cache entry `{ id, name, status: "processing", thumbnails: [] }` and uploads the binary to the returned `presignedUrl`.
- The documents list hook (`useDocuments`) invalidates `["documents"]` so the server data replaces the optimistic entry once the handler commits.

### 4. Async Pipelines

1. **Thumbnail Worker** (`workers/thumbnail-worker.ts`): consumes `document.uploaded` from the outbox, generates thumbnails, stores them in S3, updates the `documents` table via `handleMarkDocumentThumbnailed`, and emits a `document.thumbnails_ready` event. Uses the same Unit-of-Work discipline so DB + outbox stay consistent.
2. **GraphRAG Orchestrator** (`workers/graphrag-orchestrator.ts`): also listens to `document.uploaded` when `requiresGraphRag` is true. It chunk-reads the file from S3, builds embeddings/graph edges, stores results, then enqueues `document.graphrag_completed` with summary metadata.
3. **Completion Handler** (`server/commands/documents/mark-ready.ts`): triggered by the completion events to set `status` to `ready`, attach thumbnail URLs and GraphRAG metadata, and emit notifications if needed.

All workers log with the originating `traceId` so support can link user uploads to background processing.

### 5. UI Reconciliation

`useDocuments` keeps a shared TanStack cache. After the mutation invalidates the key, components rerender with the canonical `documents` list (still `processing`). When thumbnail/GraphRAG handlers update the row, the next fetch (or SSE/pusher event) updates the list automatically, swapping in the generated thumbnails and status badges without a full page refresh.

### 6. Failure Handling

- If the upload fails before hitting S3, the mutation rejects and the optimistic cache entry is rolled back.
- If thumbnail or GraphRAG processing fails, the worker records the error, increments `attempt_count`, and retries with backoff. After max attempts, it emits `document.processing_failed`, and a separate handler marks the document as `failed` so the UI can prompt the user to retry.
- Metrics to monitor: `document.upload.request_duration`, `outbox.pending` for document events, `graphrag.lag_ms`, `thumbnail.success_rate`.

This worked example ties every layer together—from thin transports and command handlers, through durable outbox events, into long-running GraphRAG pipelines—and shows how optimistic UI updates coexist with asynchronous processing while staying inside the architecture’s guardrails.

---

By keeping the layers strict, surfacing operational detail (workers, observability), and offering an explicit lighter path for small CRUD, the architecture stays pragmatic without sacrificing reliability.
