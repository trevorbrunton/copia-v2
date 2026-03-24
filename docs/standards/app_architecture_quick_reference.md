# App Architecture — Quick Reference

_A condensed 3-page version of the Developer Guide. For full explanations, worked examples, and glossary, see `app_architecture_developer_guide.md`._

Stack: Next.js · Expo · TypeScript · Zod · Drizzle · TanStack Query · AWS · Supabase

---

## 1. Core Principle

> **Business logic lives in the Application Layer (command/query handlers). UI components, API routes, and SQL files stay thin and declarative.**

---

## 2. The Layer Model

```
┌──────────────────────────────────────────────────────┐
│  Transport Layer  (Next.js routes, Server Actions)    │
│  - Parse HTTP, call handler, map errors to status     │
│  - MUST stay under 40 lines, NO business logic        │
├──────────────────────────────────────────────────────┤
│  Application Layer  (Handlers, policies, DTOs)        │
│  - Validate input (Zod), enforce rules, coordinate tx │
│  - MUST NOT import Next.js/React or know HTTP codes   │
├──────────────────────────────────────────────────────┤
│  Data Layer  (Services, repositories)                 │
│  - Execute DB queries, CRUD operations                │
│  - Receives tx handle — never creates own connections  │
├──────────────────────────────────────────────────────┤
│  Infrastructure Layer  (Drizzle, PostgreSQL, queues)   │
│  - DB connections, migrations, background jobs         │
│  - Configuration only — no application logic           │
└──────────────────────────────────────────────────────┘
```

Layers can only call downward — never upward, never skipping.

---

## 3. The Seven-Step Request Pipeline

| Step | What Happens | Where |
|------|-------------|-------|
| 1. Receive request | Route handler accepts HTTP request | `app/api/*/route.ts` |
| 2. Validate input | Zod schemas confirm payload shape | Inside handler |
| 3. Resolve identity | `requireAuthContext()` returns `AuthContext` | `src/server/require-auth-context.ts` |
| 4. Run business logic | Handler applies domain rules | `src/server/commands/` or `queries/` |
| 5. Check permissions | Policy classes verify access | `src/server/policies/` |
| 6. Persist + queue | Writes inside UoW transaction; async work to outbox | `src/server/uow/` |
| 7. Return response | Clean DTO serialized to JSON | Handler return value |

---

## 4. Data Flows

**Commands (writes):** Route → Zod validate → Handler → UoW transaction (repo save + outbox event + idempotency cache) → commit → DTO response → TanStack Query invalidation.

**Queries (reads):** Route → Zod validate → Handler → ReadOnlyExecutor (can't accidentally write) → DTO response → TanStack Query caches result.

**Async side effects:** Command saves outbox event in same transaction → Background worker polls outbox → Executes work → Retries with exponential backoff on failure → Dead-letters after max attempts.

---

## 5. Route Handler Pattern

```ts
// app/api/v1/projects/route.ts — target pattern
export async function POST(req: Request) {
  const traceId = crypto.randomUUID();
  try {
    const ctx = await requireAuthContext(req, traceId);
    const body = await req.json();
    const result = await handleCreateProject(makeDeps(), body, ctx);
    return Response.json(result, { status: 201 });
  } catch (err) {
    return handleAppError(err, traceId);
  }
}
```

Current migration pattern (140/157 routes) uses `secureHandler` + `fromSecureContext()` bridge.

---

## 6. Command Handler Pattern

```ts
// src/server/commands/projects/create-project.ts
const CreateProjectInput = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  idempotencyKey: z.string().max(100).optional(),
});

type Deps = { uow: UnitOfWork; projectRepo: ProjectRepository; projectPolicy: ProjectPolicy; outbox: OutboxWriter; idempotency: IdempotencyStore };

export async function handleCreateProject(deps: Deps, rawInput: unknown, ctx: AuthContext) {
  const input = CreateProjectInput.parse(rawInput);
  await deps.projectPolicy.assertCanCreate(ctx);

  return deps.uow.run(ctx, async (tx) => {
    if (input.idempotencyKey) {
      const cached = await deps.idempotency.get(tx, input.idempotencyKey);
      if (cached) return cached;
    }

    const record = await deps.projectRepo.create(tx, { ...input, createdBy: ctx.principalId });

    if (FEATURES.OUTBOX_ENABLED) {
      await deps.outbox.enqueue(tx, {
        type: "project.created.v1", aggregateId: record.id,
        payload: { version: 1, projectId: record.id, name: input.name },
        traceId: ctx.traceId,
      });
    }

    const result = { id: record.id, name: record.name, createdAt: record.createdAt.toISOString() };
    if (input.idempotencyKey) await deps.idempotency.put(tx, input.idempotencyKey, result);
    return result;
  });
}
```

**Key points:** `rawInput: unknown` forces Zod validation. Dependencies are injected (testable with fakes). All writes wrapped in UoW transaction. Outbox event in same transaction guarantees consistency.

---

## 7. Query Handler Pattern

```ts
export async function handleListProjects(
  deps: { readOnly: ReadOnlyExecutor; projectQueries: ProjectQueryService },
  rawInput: unknown, ctx: AuthContext,
) {
  const input = ListProjectsInput.parse(rawInput);
  const rows = await deps.readOnly.run(ctx, (tx) => deps.projectQueries.list(tx, input));
  return { items: rows.items.map(toProjectDTO), cursor: rows.nextCursor };
}
```

Uses `ReadOnlyExecutor` (sets `SET TRANSACTION READ ONLY`). No outbox, no idempotency.

---

## 8. Authorization

**AuthContext** carries `principalId`, `supabaseId`, `email`, `roles`, `traceId`.

**Policies** encapsulate permission checks — throw `ForbiddenError` or `NotFoundError` (use 404 to hide resource existence from unauthorized users).

**RLS** (Row-Level Security) enforces tenant isolation at the database level via `app.tenant_id` session variable. UoW sets this automatically per transaction.

**Division:** RLS handles tenant isolation (simple, universal). Policies handle role-based and state-based access (complex, testable in TypeScript).

---

## 9. Unit of Work, Outbox, and Idempotency

| Pattern | Problem Solved | How |
|---------|---------------|-----|
| **Unit of Work** | Partial writes leaving inconsistent state | Wraps all DB operations in a single transaction |
| **Outbox** | Async work lost if service is down | Records events in same transaction; worker processes later |
| **Idempotency** | Network retries creating duplicates | Client sends unique key; handler returns cached result on retry |

**Event contracts:** Version all outbox payloads (`project.created.v1`). Never modify existing schemas — create new versions. Validate on both producer and consumer sides.

**Worker lifecycle:** Poll with `FOR UPDATE SKIP LOCKED` → process → on failure: exponential backoff retry → after max attempts: dead-letter + alert.

---

## 10. Composition Root

```ts
// src/server/make-deps.ts — wires all real implementations
export function makeDeps(): AppDeps {
  if (!_deps) {
    _deps = {
      uow: new DrizzleUoW(),
      readOnly: new DrizzleReadOnly(),
      get projectRepo() { return new DrizzleProjectRepository(); },  // Lazy
      get outbox() { return new DrizzleOutboxWriter(); },            // Lazy
    };
  }
  return _deps;
}
```

In tests, pass fakes instead. In production, `makeDeps()` returns real implementations. Uses lazy getters to avoid constructing unused dependencies.

---

## 11. Choosing a Path

| | Tier A — Durable Flow | Tier B — Lightweight Flow |
|---|---|---|
| **When** | Shared data, money, mobile clients, async effects, compliance | Internal CRUD, prototypes, read-mostly admin |
| **Required** | Everything below | AuthContext, Zod, Policy, UoW, DTOs |
| **Optional** | — | Idempotency, Outbox, Typed hooks |

**Promotion rule:** If a Tier B feature ships to customers, gains async effects, or needs mobile access — upgrade to Tier A first.

---

## 12. Architecture Guardrails

| Rule | Level |
|------|-------|
| Business logic in handlers, not routes/components | **Required** |
| Every write uses Unit of Work | **Required** |
| Outbox is the only path for async effects | **Required** (A) / Conditional (B) |
| Route handlers under 40 lines | **Required** |
| Policies enforce authorization | **Required** |
| Shared Zod contracts for API client + server | **Required** when API shared |
| Idempotency keys on retry-prone commands | **Required** external / Optional internal |
| Observability (traceId, structured logs) | **Required** |
| TanStack hooks wrap the API client | **Required** on shared hooks |
| Workers handle duplicate delivery | **Required** |

---

## 13. Testing Strategy

| Layer | Test With | Dependencies |
|-------|----------|-------------|
| Policies / domain rules | Pure functions | None |
| Command handlers | Validation, policies, tx orchestration | Fake repos, spy outbox |
| Query handlers | Filters, DTO mapping, pagination | Fake query services |
| Repositories | SQL correctness | Real test database |
| Transport | Request parsing, status codes | Mock handlers |
| Workers | Retry logic, dedup, dead-letter | Fake outbox + services |

**Best practices:** Test handlers (not routes). Use fakes (not mocks). Run integration tests against real PostgreSQL.

---

## 14. New Feature Checklist

- [ ] Choose Tier A or Tier B (note in PR)
- [ ] Handler created under `server/commands` or `server/queries`
- [ ] Handler signature is `(deps, rawInput, ctx)` with no framework imports
- [ ] Zod schemas exist for request and response
- [ ] Policy enforces authorization
- [ ] UoW wraps writes; reads use `readOnly` executor
- [ ] Outbox + idempotency + versioned events wired (Tier A)
- [ ] Route handler under 40 lines
- [ ] TanStack hook uses typed API client
- [ ] `traceId` flows through logs/outbox/errors
- [ ] Tests cover happy/sad paths
- [ ] Log message + metric for new command/query

---

## 15. Error Handling

Standard error envelope: `{ "error": { "code": "...", "message": "...", "traceId": "..." } }`

| Code | Status | When |
|------|--------|------|
| `VALIDATION_ERROR` | 400/422 | Zod schema failed |
| `UNAUTHORIZED` | 401 | Missing/invalid credentials |
| `FORBIDDEN` | 403 | Policy rejected access |
| `NOT_FOUND` | 404 | Resource missing or hidden |
| `CONFLICT` | 409 | Duplicate data or stale version |
| `RATE_LIMITED` | 429 | Too many requests |
| `INTERNAL_ERROR` | 500 | Unexpected failure (bug) |

Handlers throw typed `AppError` subclasses. The transport layer maps them to HTTP status codes via `handleAppError()`.

---

_For detailed explanations, worked examples (Document Upload + GraphRAG pipeline), future development patterns, and a full glossary, see `app_architecture_developer_guide.md`._
