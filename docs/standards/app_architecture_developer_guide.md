# App Architecture — Developer Guide

_A deep-dive companion to the CronIq architecture, written for developers who are new to layered application design, backend patterns, and production-grade TypeScript. This guide also serves as a north star for architectural principles across all projects — the patterns described here are not Mayfly-specific, and the [Future Developments](#future-developments-scaling-the-architecture) section provides guidance on when to adopt more advanced patterns as applications grow._

Stack: Next.js • Expo • TypeScript • Zod • Drizzle • TanStack Query • AWS • Supabase

---

## Table of Contents

1. [How to Use This Guide](#how-to-use-this-guide)
2. [Why Do We Need an Architecture?](#why-do-we-need-an-architecture)
3. [The Core Principle](#the-core-principle)
4. [The Seven-Step Request Pipeline](#the-seven-step-request-pipeline)
5. [Data Journeys](#data-journeys)
6. [The Layer Model](#the-layer-model)
7. [Transport Layer Deep Dive](#transport-layer-deep-dive)
8. [Application Layer Deep Dive](#application-layer-deep-dive)
9. [Data Layer Deep Dive](#data-layer-deep-dive)
10. [Infrastructure Layer Deep Dive](#infrastructure-layer-deep-dive)
11. [Validation and Contracts](#validation-and-contracts)
12. [Authorization Model](#authorization-model)
13. [Unit of Work, Outbox, and Idempotency](#unit-of-work-outbox-and-idempotency)
14. [Observability](#observability)
15. [API Design and Error Handling](#api-design-and-error-handling)
16. [Multi-Client Data Access](#multi-client-data-access)
17. [Choosing a Path: Standard vs Lightweight](#choosing-a-path-standard-vs-lightweight)
18. [Architecture Guardrails](#architecture-guardrails)
19. [Testing Strategy](#testing-strategy)
20. [Decision Guides](#decision-guides)
21. [Async Worker Details](#async-worker-details)
22. [Future Developments: Scaling the Architecture](#future-developments-scaling-the-architecture)
23. [New Feature Checklist](#new-feature-checklist)
24. [Appendix: Reference Tables](#appendix-reference-tables)
25. [Appendix: Worked Example — Document Upload + GraphRAG Pipeline](#appendix-worked-example--document-upload--graphrag-pipeline)

---

## How to Use This Guide

This guide is the expanded, beginner-friendly version of our architecture reference. It assumes you understand basic TypeScript and have some familiarity with React, but may be new to concepts like "layered architecture," "unit of work," or "outbox patterns."

**Reading strategies:**

1. **Brand new to backend development?** Read from top to bottom. The concepts build on each other.
2. **Already know some backend patterns?** Use the table of contents to jump to the sections you need.
3. **Working on a specific feature?** Read the [New Feature Checklist](#new-feature-checklist) first, then backtrack to understand any unfamiliar concepts.
4. **Just want to know if something is required?** Check the [Architecture Guardrails](#architecture-guardrails) section.

### Canonical Names vs. Current Implementation

Throughout this guide, you'll see two kinds of code examples:

- **Code that already exists in the repo** — referenced by its actual file path (e.g., `src/server/make-deps.ts`).
- **Code that represents the target architecture** — marked with a 📌 icon. These are the patterns we've adopted. When you see 📌, it means "this is the blueprint we follow." As of March 2026, the core infrastructure (Handlers, DI, UoW, Outbox) is fully implemented and in production use.

Why does this matter? Because as a developer, you need to know whether you're looking at the standard pattern we've established or an older part of the codebase that hasn't been migrated yet. Both are valuable — the existing code shows you how things work today, and the 📌 items show you the standard you should follow when building new features.

---

## Why Do We Need an Architecture?

If you've only worked on small projects or tutorials, you might wonder: "Why not just put the database query right in the React component? Or write all the logic in the API route?"

Here's why:

### The Problems We're Solving

1. **Code gets tangled.** Without clear boundaries, business logic (like "a user can only create 10 projects") ends up scattered across React components, API routes, and database queries. When the rule changes, you have to hunt through the entire codebase.

2. **Testing becomes painful.** If your API route directly calls the database, you can't test the business logic without setting up a real database. With layers, you can test business rules with simple fake objects.

3. **Multiple clients break things.** Today we have a web app. Tomorrow we might have a mobile app or partner API. If business logic lives in a Next.js route handler, the mobile app can't reuse it — you'd have to duplicate everything.

4. **Bugs hide in complexity.** When one function does authentication, validation, database queries, error handling, and response formatting all at once, it's hard to spot mistakes. Separating concerns makes each piece small enough to reason about.

5. **New developers get lost.** When there's no consistent pattern, every file is different. With a clear architecture, once you understand one feature's code, you understand them all.

### The Solution: Layers

We solve these problems by organizing code into **layers**, where each layer has one job and clear rules about what it can and cannot do. Think of it like a kitchen in a restaurant:

- The **waiter** (Transport Layer) takes orders and brings food — but doesn't cook.
- The **chef** (Application Layer) decides what to cook and how — but doesn't take orders.
- The **prep cook** (Data Layer) chops vegetables and manages ingredients — but doesn't decide the menu.
- The **kitchen equipment** (Infrastructure Layer) provides ovens and fridges — but doesn't cook food.

Each person has a clear job. If the waiter starts cooking, things go wrong. Same with our code.

---

## The Core Principle

> **Business logic lives in the Application Layer (command/query handlers). UI components, API routes, and SQL files stay thin and declarative.**

This is the single most important rule in our architecture. Let's break it down:

- **Business logic** = rules about what your app does. "A project name must be unique per user." "Only active users can create meetings." "When a document is uploaded, kick off processing."
- **Application Layer** = the `src/server/commands/` and `src/server/queries/` folders. This is where business rules live.
- **Thin and declarative** = other layers should be short and obvious. A route handler should basically say "get the user, parse the body, call the handler, return the result" — nothing more.

### Why This Matters in Practice

**Bad example** — business logic in a route handler:
```ts
// DON'T DO THIS
export async function POST(req: Request) {
  const user = await getUser(req);
  const body = await req.json();

  // Business logic leaking into the route!
  if (body.name.length < 1) return Response.json({ error: "Name required" }, { status: 400 });

  const existing = await db.select().from(projects).where(eq(projects.name, body.name));
  if (existing.length > 0) return Response.json({ error: "Duplicate" }, { status: 409 });

  const project = await db.insert(projects).values({ name: body.name, userId: user.id });

  // More business logic — sending emails from the route!
  await sendEmail(user.email, "Project created!");

  return Response.json(project, { status: 201 });
}
```

**Good example** — route handler delegates to a handler:
```ts
// DO THIS
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

The good example is 9 lines. The business logic (validation, duplicate checking, email sending) lives in `handleCreateProject` where it can be tested independently and reused by mobile clients.

---

## The Seven-Step Request Pipeline

Every request that hits our server follows the same seven steps. Understanding this pipeline is key to knowing where your code should go.

| Step | What Happens | Where in Code | Why |
| --- | --- | --- | --- |
| 1. **Receive the request** | A route handler or Server Action accepts the HTTP request | `app/api/*/route.ts` | The framework (Next.js) gives us the raw request |
| 2. **Validate input** | Zod schemas confirm the payload has the right shape and types | Inside the command/query handler | Catches bad data before it can cause damage |
| 3. **Resolve identity** | `requireAuthContext()` figures out who is making the request | `src/server/require-auth-context.ts` | We need to know who the user is before we can check permissions |
| 4. **Run business logic** | The handler applies domain rules, coordinates data access | `src/server/commands/` or `src/server/queries/` | This is the "brain" of the operation |
| 5. **Check permissions** | Policy classes verify the user is allowed to do this action | `src/server/policies/` (📌) | Security — just because you're logged in doesn't mean you can do everything |
| 6. **Persist and queue side effects** | Writes happen inside a transaction; async work goes to the outbox | `src/server/uow/` | Ensures data consistency — either everything succeeds or nothing does |
| 7. **Return a response** | The handler returns a clean DTO that gets serialized to JSON | Handler return value | The client gets a predictable, typed response |

### What's a DTO?

DTO stands for **Data Transfer Object**. It's a fancy name for "the shape of data you send back to the client." Instead of returning the raw database row (which might include internal fields like `password_hash`), you construct a clean object with only the fields the client needs:

```ts
// Raw database row — DON'T send this to clients
{ id: "abc", name: "My Project", user_id: "xyz", created_at: "2024-01-01", internal_flags: 42 }

// DTO — DO send this
{ id: "abc", name: "My Project", createdAt: "2024-01-01T00:00:00.000Z" }
```

---

## Data Journeys

There are three types of data flow in our application. Understanding which one you're building helps you pick the right tools.

### 1. Mutations (Commands) — "Change something"

When a user creates, updates, or deletes data, we call it a **mutation** or **command**. The data flows like this:

```
User clicks "Create Project"
    ↓
Browser sends POST /api/projects
    ↓
Route handler receives request
    ↓
Zod validates the input (is the name a string? Is it under 200 chars?)
    ↓
Command handler runs business logic
    ↓
Unit of Work opens a database transaction
    ↓
  ├── Repo saves the project
  ├── Outbox records "project.created" event (for async work)
  └── Idempotency store caches the result (for safe retries)
    ↓
Transaction commits (all three writes succeed or all fail together)
    ↓
DTO response sent back to browser
    ↓
TanStack Query updates the UI
```

**Key concept: Transaction.** A transaction means "do all of these database writes together, or none of them." If saving the project succeeds but the outbox write fails, the whole thing rolls back. This prevents data getting into a half-finished state.

### 2. Reads (Queries) — "Show me something"

When a user views a list or detail page, we call it a **query**. Reads are simpler because they don't change data:

```
User opens the Projects page
    ↓
Browser sends GET /api/projects
    ↓
Route handler receives request
    ↓
Zod validates query parameters (page number, filters)
    ↓
Query handler runs logic
    ↓
Read-only executor fetches data (can't accidentally write!)
    ↓
DTO response sent back
    ↓
TanStack Query caches the result for fast re-renders
```

**Why separate reads from writes?** Because they have different performance characteristics. Reads can be cached aggressively, run against read replicas, and don't need transactions. By separating them, we can optimize each independently.

### 3. Async Side Effects — "Do something later"

Some work is too slow or too unreliable to do during the user's request. For example, sending an email, generating thumbnails, or running AI processing. We handle these asynchronously:

```
Command handler saves the project AND an outbox event (same transaction)
    ↓
User gets their response immediately (fast!)
    ↓
Meanwhile, a background worker polls the outbox table
    ↓
Worker picks up the "project.created" event
    ↓
Worker sends the welcome email
    ↓
Worker marks the event as "completed"
    ↓
If the email fails, worker retries with exponential backoff
```

**Why not just send the email directly in the handler?** Two reasons:

1. **Speed:** The user doesn't want to wait 2 seconds for an email to send. They want their project created instantly.
2. **Reliability:** What if the email service is down? If you send the email in the handler, the whole request fails even though the project was created successfully. With the outbox pattern, the project is saved, and the email will be retried later.

---

## The Layer Model

Here's our application as a layered diagram. Each layer can only talk to the layer directly below it — never upward, and never skipping layers.

```
┌────────────────────────────────────────────────────────┐
│ Transport Layer                                        │
│ (Next.js routes, Server Actions, Expo RPC)             │
│                                                        │
│ Responsibilities:                                      │
│ - Parse HTTP requests and form submissions             │
│ - Call the appropriate handler                         │
│ - Convert errors into HTTP status codes                │
│ - Return JSON responses                                │
│                                                        │
│ Rules:                                                 │
│ - MUST stay under 40 lines                             │
│ - MUST NOT contain business logic                      │
│ - MUST NOT import database code                        │
├────────────────────────────────────────────────────────┤
│ Application Layer                                      │
│ (Handlers, policies, DTO builders)                     │
│                                                        │
│ Responsibilities:                                      │
│ - Validate input with Zod                              │
│ - Enforce business rules and policies                  │
│ - Coordinate transactions (Unit of Work)               │
│ - Build DTOs for responses                             │
│                                                        │
│ Rules:                                                 │
│ - MUST NOT import Next.js or React                     │
│ - MUST NOT know about HTTP status codes                │
│ - CAN throw typed errors (the transport maps them)     │
├────────────────────────────────────────────────────────┤
│ Data Layer                                             │
│ (Services, repositories, query services)               │
│                                                        │
│ Responsibilities:                                      │
│ - Execute database queries                             │
│ - Implement CRUD operations                            │
│ - Manage cache reads/writes                            │
│                                                        │
│ Rules:                                                 │
│ - MUST NOT contain business logic                      │
│ - MUST NOT import framework code                       │
│ - Functions receive a transaction handle, not create    │
│   their own connections                                │
├────────────────────────────────────────────────────────┤
│ Infrastructure Layer                                   │
│ (Drizzle, PostgreSQL, queues, workers)                 │
│                                                        │
│ Responsibilities:                                      │
│ - Provide database connections                         │
│ - Run migrations                                       │
│ - Process background jobs                              │
│                                                        │
│ Rules:                                                 │
│ - Configuration only — no application logic            │
└────────────────────────────────────────────────────────┘
```

### Why Can't Layers Talk Upward?

Imagine if a database service imported a React component. Now the service depends on React — you can't use it in a mobile app, a CLI tool, or a background worker. By enforcing "layers only talk downward," we keep each layer reusable in different contexts.

### The "Dependency Rule"

This is a formal way of saying the same thing: **source code dependencies can only point inward (downward)**. The Transport Layer knows about the Application Layer, but the Application Layer has no idea it's being called from a Next.js route vs. a mobile app vs. a test.

---

## Transport Layer Deep Dive

The transport layer is the thinnest layer. Its only job is to translate between the outside world (HTTP requests) and our application layer (handlers).

### Route Handler Example

_File: `app/api/v1/projects/route.ts`_

```ts
import { requireAuthContext } from "@/src/server/require-auth-context";
import { handleCreateProject } from "@/src/server/commands/projects/create-project";
import { handleListProjects } from "@/src/server/queries/projects/list-projects";
import { handleAppError } from "@/src/server/errors";
import { makeDeps } from "@/src/server/make-deps";

export async function POST(req: Request) {
  const traceId = crypto.randomUUID();            // Unique ID for this request
  try {
    const ctx = await requireAuthContext(req, traceId); // Step 3: Who is this?
    const body = await req.json();                // Step 1: What did they send?
    const result = await handleCreateProject(     // Step 4-6: Do the work
      makeDeps(),                                 // Inject dependencies
      body,                                       // Raw input (handler validates it)
      ctx,                                        // Authenticated user context
    );
    return Response.json(result, { status: 201 }); // Step 7: Send response
  } catch (err) {
    return handleAppError(err, traceId);          // Convert errors to HTTP
  }
}
```

Let's break down each line:

| Line | What It Does | Why |
| --- | --- | --- |
| `crypto.randomUUID()` | Generates a unique trace ID for this request. This ID follows the request through auth, handlers, database transactions, logs, and error responses. | Enables end-to-end request tracing for debugging and observability. |
| `requireAuthContext(req, traceId)` | Reads the authentication token from cookies (web) or the `Authorization` header (mobile). Returns an `AuthContext` object with the user's ID, roles, and the `traceId`. If the user isn't logged in, it throws an error immediately. | We need to know who is making the request before we do anything else. |
| `await req.json()` | Extracts the raw JSON body from the HTTP request. At this point, we don't know if it's valid — that's the handler's job. | The transport layer just passes raw data through. |
| `makeDeps()` | Creates all the dependencies the handler needs (database connection, repositories, etc.). This is our "composition root" — more on this later. | Handlers don't create their own database connections. They receive them, making testing easy (you can pass in fakes). |
| `handleCreateProject(deps, body, ctx)` | The actual work. This function validates input, checks permissions, saves data, and returns a DTO. | All business logic lives here. |
| `Response.json(result, { status: 201 })` | Sends the handler's result back as JSON with a 201 (Created) status code. | Standard HTTP response. |
| `handleAppError(err, traceId)` | If anything throws an error, this function maps it to the right HTTP status code and error format, including the `traceId` for client-side correlation. | Consistent error responses for all clients. |

### Current Migration State

The example above shows the **target pattern** using `requireAuthContext(req, traceId)`. In practice, most routes currently use `secureHandler` (a legacy wrapper that provides JWT + RLS) with a bridge function:

```ts
// Current pattern (140 of 157 routes use this)
import { secureHandler } from "@/src/lib/secure-handler";
import { fromSecureContext } from "@/src/server/auth-context";
import { handleAppError } from "@/src/server/errors";
import { makeDeps } from "@/src/server/make-deps";

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

`fromSecureContext(sc, traceId)` maps `sc.userId` → `ctx.principalId`. The `secureHandler` wrapper still provides JWT validation and RLS context (`withTenantContext`). The UoW/ReadOnly executors independently set RLS as defense-in-depth.

**17 routes are documented exceptions** (entity factory routes, OAuth, SSE streaming, internal handlers) that use different patterns. See `docs/plans/architecture-compliance-remediation-plan.md` for the full list.

### The 40-Line Rule

Notice how short this route handler is? That's intentional. We have a hard rule: **route handlers must stay under 40 lines**. If your route handler is getting longer, that's a sign you're putting business logic in the wrong place.

The route handler's job is purely mechanical: receive request → call handler → send response. It's like a mail clerk — they deliver letters, they don't read them.

### Server Actions (Web-Only Alternative)

Next.js provides Server Actions as an alternative to route handlers for form submissions. They follow the exact same pattern:

_File: `app/projects/actions.ts`_ (📌 — not yet implemented)

```ts
"use server";
import { requireSessionUser } from "@/src/server/require-auth-context";
import { handleCreateProject } from "@/src/server/commands/projects/create-project";
import { makeDeps } from "@/src/server/make-deps";

export async function createProjectAction(formData: FormData) {
  const traceId = crypto.randomUUID();
  const ctx = await requireSessionUser(traceId); // Same auth check
  return handleCreateProject(                     // Same handler
    makeDeps(),
    {
      name: formData.get("name"),           // Different input source (form vs JSON)
      description: formData.get("description"),
      status: formData.get("status"),
    },
    ctx,
  );
}
```

The key insight: **the handler doesn't care whether it's called from a route handler or a Server Action**. It receives `(deps, rawInput, ctx)` either way. This is the power of separating transport from application logic.

---

## Application Layer Deep Dive

This is where the interesting work happens. The application layer contains two types of handlers:

- **Command handlers** (`src/server/commands/`) — for operations that change data (create, update, delete).
- **Query handlers** (`src/server/queries/`) — for operations that read data.

### Why Separate Commands from Queries?

This pattern is called **CQRS** (Command Query Responsibility Segregation). The idea is simple: reading data and writing data are fundamentally different operations with different needs.

| Aspect | Commands (Writes) | Queries (Reads) |
| --- | --- | --- |
| Database access | Needs a transaction (Unit of Work) | Read-only executor (can't accidentally write) |
| Caching | Must invalidate caches | Can be cached aggressively |
| Complexity | Validation, policies, side effects | Filters, pagination, DTO mapping |
| Failure mode | Must be atomic (all-or-nothing) | Can return partial results |

### Command Handler Anatomy

Let's walk through a complete command handler step by step.

_File: `src/server/commands/projects/create-project.ts`_

**Step 1 — Define the input schema**

```ts
import { z } from "zod";

export const CreateProjectInput = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  status: z.enum(["active", "draft", "completed", "archived"]).optional(),
  idempotencyKey: z.string().max(100).optional(),
});
```

This is a [Zod](https://zod.dev/) schema. It defines exactly what shape the input must have:

- `name` must be a string between 1 and 200 characters (required).
- `description` is optional, max 2000 characters.
- `status` must be one of the listed values (or omitted).
- `idempotencyKey` is optional — we'll explain this later.

**Why Zod?** TypeScript types only exist at compile time — they're erased when the code runs. Zod gives us **runtime** validation. When a user sends `{ name: 123 }` (a number instead of a string), Zod catches it and throws a descriptive error.

**Step 2 — Define dependencies and the function signature**

```ts
type Deps = {
  uow: UnitOfWork;                    // For wrapping writes in a transaction
  projectRepo: ProjectRepository;     // For saving/finding projects in the DB
  projectPolicy: ProjectPolicy;       // For checking permissions
  outbox: OutboxWriter;               // For queuing async side effects
  idempotency: IdempotencyStore;      // For safe retries
};

export async function handleCreateProject(
  deps: Deps,          // All external dependencies
  rawInput: unknown,   // Unvalidated input (could be anything)
  ctx: AuthContext,    // The authenticated user
) {
  const input = CreateProjectInput.parse(rawInput);  // Validate or throw
  await deps.projectPolicy.assertCanCreate(ctx, input.status ?? "active");
```

**Key concepts here:**

- **`rawInput: unknown`** — The handler receives input as `unknown`, not as a typed object. This forces us to validate it with Zod before using it. If we typed it as `CreateProjectInput`, TypeScript would trust the type but the runtime data might be garbage.
- **`deps: Deps`** — Instead of importing the database directly, the handler receives its dependencies. This is called **Dependency Injection**. It makes testing easy because you can pass in fakes:

```ts
// In tests, you can do this:
const fakeDeps = {
  uow: new FakeUnitOfWork(),
  projectRepo: new InMemoryProjectRepo(),
  projectPolicy: new AlwaysAllowPolicy(),
  outbox: new SpyOutbox(), // Records calls without sending real emails
  idempotency: new InMemoryIdempotency(),
};
await handleCreateProject(fakeDeps, { name: "Test" }, testUser);
```

- **`ctx: AuthContext`** — Information about who is making the request. The handler doesn't need to parse cookies or tokens — that's the transport layer's job.

**Step 3 — Transaction body**

```ts
  return deps.uow.run(ctx, async (tx) => {
    // Check for duplicate request (idempotency)
    if (input.idempotencyKey) {
      const cached = await deps.idempotency.get(tx, input.idempotencyKey);
      if (cached) return cached;  // Return the same result as last time
    }

    // Check for duplicate project name
    const duplicate = await deps.projectRepo.findByName(tx, {
      ownerId: ctx.principalId,
      name: input.name,
    });
    if (duplicate) throw new ConflictError("Project already exists");

    // Create the project
    const record = await deps.projectRepo.create(tx, {
      ...input,
      createdBy: ctx.principalId,
    });

    // Queue async side effects (see Event Contracts for versioned schema pattern)
    // Events are only published when OUTBOX_ENABLED=true (feature flag).
    // The userId ensures tenant isolation — the outbox table has RLS.
    if (FEATURES.OUTBOX_ENABLED) {
      await deps.outbox.enqueue(tx, {
        userId: ctx.principalId,
        type: "project.created.v1",
        aggregateType: "project",
        aggregateId: record.id,
        payload: { version: 1, projectId: record.id, name: input.name },
        traceId: ctx.traceId,
      });
    }

    // Build the response DTO
    const result = {
      id: record.id,
      name: record.name,
      createdAt: record.createdAt.toISOString(),
    };

    // Cache the result for idempotent retries
    if (input.idempotencyKey) {
      await deps.idempotency.put(tx, input.idempotencyKey, result);
    }

    return result;
  });
}
```

Let's unpack what's happening inside the transaction:

1. **Idempotency check:** "Have we already processed this exact request?" If yes, return the cached result. This is crucial for handling network retries — if the user's browser sends the same request twice, we don't create two projects. More on this in the [Idempotency section](#unit-of-work-outbox-and-idempotency).

2. **Duplicate check:** Business rule — a user can't have two projects with the same name. This is domain logic, not database constraint enforcement (though you'd ideally have both).

3. **Create the record:** Save the project via the repository. Notice we pass `tx` (the transaction handle), not a standalone database connection. This means the insert is part of the transaction.

4. **Outbox enqueue:** Record an event saying "a project was created." A background worker will pick this up later to send emails, update search indexes, etc. Crucially, this happens in the **same transaction** as the insert. If the insert fails, the event is also rolled back — no phantom events.

5. **Build the DTO:** Construct a clean response object. Note how `createdAt` is converted to an ISO string — we normalize dates for consistency across clients.

6. **Cache for idempotency:** Store the result so if this same request comes again, we return the same response.

> 📌 _Implementation status:_ This canonical handler pattern is fully implemented and used across all core domains (entities, documents, community, care). The infrastructure for outbox, idempotency, and policies is active in production.

### Query Handler Anatomy

Query handlers are simpler because they don't modify data.

_File: `src/server/queries/projects/list-projects.ts`_

```ts
import { z } from "zod";

export const ListProjectsInput = z.object({
  search: z.string().optional(),                          // Free-text search
  status: z.string().optional(),                          // Filter by status
  cursor: z.string().optional(),                          // Pagination cursor
  limit: z.coerce.number().int().min(1).max(100).default(20), // Page size
});

export async function handleListProjects(
  deps: {
    readOnly: ReadOnlyExecutor;       // Can only read, not write
    projectPolicy: ProjectPolicy;
    projectQueries: ProjectQueryService;
  },
  rawInput: unknown,
  ctx: AuthContext,
) {
  const input = ListProjectsInput.parse(rawInput);
  await deps.projectPolicy.assertCanList(ctx, ctx.orgId);

  const rows = await deps.readOnly.run(ctx, (tx) =>
    deps.projectQueries.list(tx, input),
  );

  return {
    items: rows.items.map(toProjectDTO),  // Convert DB rows to DTOs
    cursor: rows.nextCursor,              // For fetching the next page
  };
}
```

**Key differences from command handlers:**

- Uses `readOnly` instead of `uow` — this executor sets `SET TRANSACTION READ ONLY` on the database connection, which means any accidental `INSERT` or `UPDATE` would throw an error. This is a safety net.
- No outbox or idempotency — reads don't have side effects.
- Returns a paginated list with a cursor — standard pattern for list endpoints.

**What's cursor-based pagination?** Instead of using page numbers (`?page=3`), we use a cursor — an opaque string that points to the last item on the previous page. The client passes it back to get the next page. This is more reliable than page numbers because it handles items being added or removed between requests.

### Policy Classes

Policies answer the question: **"Is this user allowed to do this action on this resource?"**

_File: `src/server/policies/project-policy.ts`_

Today, policies are simple objects with noop methods — any authenticated user can perform any action:

```ts
// Current: all methods are noops (any authenticated user is allowed)
export const projectPolicy = {
  assertCanCreate(_ctx: AuthContext) {},
  assertCanView(_ctx: AuthContext) {},
  assertCanUpdate(_ctx: AuthContext) {},
  assertCanDelete(_ctx: AuthContext) {},
};
```

When roles are added, these become the enforcement point:

```ts
// 📌 Target: class with real enforcement when RBAC is needed
export class ProjectPolicy {
  // Can this user create projects at all?
  assertCanCreate(ctx: AuthContext) {
    if (!ctx.roles.includes("project:write")) {
      throw new ForbiddenError();
    }
  }

  // Can this user view this specific project?
  assertCanView(ctx: AuthContext, record: Project) {
    // Return 404 instead of 403 to hide the project's existence
    if (record.userId !== ctx.principalId) {
      throw new NotFoundError();
    }
  }
}
```

**Why separate policies from handlers?**

1. **Testability:** You can test permission logic independently: "Given a user with role X, can they do Y?"
2. **Auditability:** All permission checks live in one place. When someone asks "who can delete a project?", you look at the policy.
3. **Reusability:** Multiple handlers might need the same permission check.

**Important security pattern:** Notice that `assertCanView` throws `NotFoundError`, not `ForbiddenError`. This is intentional — if User A tries to access User B's project, we don't want to reveal that the project exists. We pretend it doesn't exist (404) instead of saying "you're not allowed" (403).

### The Composition Root

_File: `src/server/make-deps.ts`_

The current implementation uses module-level caching — `makeDeps()` constructs the dependency object once and reuses it for every subsequent call:

```ts
let _deps: Deps | null = null;

export function makeDeps(): Deps {
  if (!_deps) {
    _deps = {
      uow: new DrizzleUoW(),
      readOnly: new DrizzleReadOnly(),
      projectPolicy,     // Plain objects with noop methods (see Policies below)
      meetingPolicy,
      chatPolicy,
    };
  }
  return _deps;
}
```

This function is called the **composition root** — it's the single place where we wire up all the real implementations. Every handler receives its dependencies through this function.

**Why is this powerful?**

- **In production:** `makeDeps()` returns real database-backed implementations.
- **In tests:** You can pass in fakes (in-memory repos, spy outbox, etc.), giving you millisecond test feedback without touching a database.
- **Swapping implementations:** If we switch from Drizzle to another ORM, we only change this one file plus the implementation classes — handlers don't change at all.

As the composition root grows to include repositories, query services, outbox, and idempotency, it will look more like this:

```ts
// 📌 Target: full composition root with all domain dependencies
export function makeDeps(): AppDeps {
  if (!_deps) {
    _deps = {
      uow: new DrizzleUoW(),
      readOnly: new DrizzleReadOnly(),
      projectRepo: new DrizzleProjectRepository(),
      projectQueries: new DrizzleProjectQueryService(),
      projectPolicy: new ProjectPolicy(),
      outbox: new DrizzleOutboxWriter(),
      idempotency: new DrizzleIdempotencyStore(),
    };
  }
  return _deps;
}
```

### Scaling the Composition Root

As the application grows to dozens of domains (Projects, Users, Billing, Documents, Workflows, etc.), eagerly instantiating every dependency becomes wasteful. A route that only needs `projectRepo` shouldn't pay the cost of constructing `billingService`, `documentRepo`, and twenty other objects.

**Use lazy getters to defer construction:**

```ts
export function makeDeps(): AppDeps {
  // Shared singletons — cheap, always needed
  const uow = new DrizzleUoW();
  const readOnly = new DrizzleReadOnly();

  return {
    uow,
    readOnly,

    // Lazy — only constructed when first accessed
    get projectRepo() { return new DrizzleProjectRepository(); },
    get projectPolicy() { return new ProjectPolicy(); },
    get meetingRepo() { return new DrizzleMeetingRepository(); },
    get outbox() { return new DrizzleOutboxWriter(); },
    // ... add new domains here
  };
}
```

With lazy getters, a handler that only destructures `{ uow, projectRepo }` never triggers construction of `meetingRepo` or `outbox`. This is a zero-dependency pattern — no DI container needed — and it scales to hundreds of services without measurable overhead.

**When to consider a DI container:** If you find yourself needing scoped lifetimes (per-request singletons), circular dependency resolution, or automatic constructor injection across 50+ services, a lightweight container like `awilix` or `tsyringe` becomes worthwhile. For most applications, lazy getters are sufficient.

> _Implementation status:_ The current `makeDeps()` is our production composition root, providing all necessary dependencies for command/query handlers. It uses the `AppDeps` interface and employs a `lazy()` memoization helper for services with heavy setup costs (like the `CareInterpreterService`).

---

## Data Layer Deep Dive

The data layer contains **services** and **repositories** — classes that know how to talk to the database but don't contain business rules.

### Services vs. Repositories

| Concept | Purpose | Example |
| --- | --- | --- |
| **Repository** | CRUD operations for a single entity. Transactional writes. | `ProjectRepository.create(tx, data)`, `ProjectRepository.findById(tx, id)` |
| **Query Service** | Read-only queries, often joining multiple tables. Optimized for performance. | `ProjectQueryService.list(tx, filters)`, `ProjectQueryService.getWithStats(tx, id)` |

**Why both?** Because writes and reads have different shapes:

- When you **write** a project, you need a clean interface: `create(tx, { name, ownerId })`. The repository handles one entity at a time.
- When you **read** a project list, you might want to join with user data, count related meetings, apply search filters, and paginate. This complex query logic belongs in a query service, not a repository.

### The `(tx, userId, ...)` Pattern

All data layer functions receive a **transaction handle** (`tx`) as their first parameter:

```ts
// Service/repository pattern
async function createProject(tx: TransactionClient, userId: string, data: CreateProjectData) {
  return tx.insert(projects).values({ ...data, userId }).returning();
}
```

**Why pass `tx` instead of using a global `db`?**

Because the handler controls the transaction boundary. When the handler calls `uow.run()`, it opens a transaction and passes the handle to services. All operations use the same transaction, so they commit or roll back together. If services created their own connections, you couldn't guarantee atomicity.

---

## Infrastructure Layer Deep Dive

The infrastructure layer provides the plumbing: database connections, ORM configuration, migration scripts, and background job runners.

### Key Infrastructure Components

| Component | File(s) | Purpose |
| --- | --- | --- |
| **Drizzle Client** | `src/db/index.ts` | Creates the database connection pool |
| **Schema** | `src/db/schema.ts` | Defines table structures as TypeScript objects |
| **Migrations** | `src/db/migrations/` | SQL files that evolve the database schema over time |
| **UoW Implementation** | `src/server/uow/drizzle-uow.ts` | Implements the Unit of Work interface using Drizzle transactions |

### Why Drizzle?

Drizzle is a TypeScript-first ORM that gives us:

- **Type-safe queries:** If you mistype a column name, TypeScript catches it at compile time.
- **Migration support:** Schema changes are tracked as numbered SQL files.
- **Lightweight:** Unlike heavier ORMs (e.g., Prisma), Drizzle generates minimal runtime overhead.

---

## Validation and Contracts

Validation is the first line of defense. Before any business logic runs, we verify that the input data is the right shape.

### Request and Response Schemas

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

**Why validate responses too?** You might think "I control the server, so the response will always be correct." But bugs happen. A response schema catches issues like:

- Accidentally including internal fields (like `password_hash`).
- Date formatting inconsistencies.
- Missing required fields after a refactor.

### Deriving Types from Schemas

```ts
// DO this:
type CreateProjectInput = z.infer<typeof CreateProjectRequest>;
// Result: { name: string; description?: string; status?: "active" | "draft" | ...; idempotencyKey?: string; }

// DON'T do this (manually duplicating the type):
type CreateProjectInput = {
  name: string;
  description?: string;
  // ... easy to forget a field or get a type wrong
};
```

Using `z.infer<>` means the TypeScript type is always in sync with the runtime validation. One source of truth.

---

## Authorization Model

Authorization answers: "Is this authenticated user allowed to perform this action?"

### AuthContext

_File: `src/server/auth-context.ts`_

```ts
export type AuthContext = {
  principalId: string;   // Internal user ID (our database primary key, UUID)
  supabaseId: string;    // Supabase auth.uid() — the external identity provider ID
  email: string;         // User's email address
  roles: string[];       // Global roles (empty today — extension point for RBAC)
  traceId: string;       // Per-request trace ID for structured logging
};
```

Today, the `AuthContext` is lean — it carries identity and tracing. As the application grows, extend it with fields like:

```ts
// 📌 Target: add these fields when multi-tenant or role-aware behavior is needed
  orgId?: string;                     // Organization/tenant ID (for multi-tenant apps)
  sessionId?: string;                 // Current session ID
  scopes: string[];                   // API scopes (for machine-to-machine auth)
  memberships: Array<{               // Resource-level permissions
    resourceType: string;            // e.g., "project", "organization"
    resourceId: string;              // e.g., "proj_abc123"
    role: string;                    // e.g., "owner", "viewer"
  }>;
```

**Why plan for so many fields?** Because authorization is rarely as simple as "admin or not admin." In a real app, a user might:

- Be an admin in one organization but a viewer in another.
- Have permission to edit some projects but only view others.
- Be using an API key with limited scopes.

The `AuthContext` is the right place to capture all of this, so policies can make fine-grained decisions.

### Common Authorization Mistakes

| Bad Pattern | Why It's Bad | Better Approach |
| --- | --- | --- |
| Checking `if (ctx.roles.includes("admin"))` directly in a handler | Scatters permission logic across the codebase | Use `projectPolicy.assertCanCreate(ctx)` |
| Only checking roles | Doesn't verify the user owns the specific resource | Check role AND the record (e.g., `record.userId === ctx.principalId`) |
| Returning 403 when a user tries to access another tenant's data | Reveals that the resource exists | Return 404 to hide the resource's existence |

### Row-Level Security (RLS)

In addition to application-level policies, our database enforces security at the row level. This means even if a bug in our code accidentally queries all projects, the database only returns rows belonging to the current user.

Our Unit of Work sets `request.jwt.claims` at the start of each transaction, which tells PostgreSQL's `auth.uid()` function who the current user is. RLS policies then filter rows automatically:

```sql
-- PostgreSQL RLS policy
CREATE POLICY "users can only see their own projects"
  ON projects FOR SELECT
  USING (user_id = auth.uid());
```

This is **defense in depth** — two layers of protection (application policies + database RLS) rather than just one.

### Keeping RLS and Policies in Their Lanes

Having two authorization layers creates a "dual-brain" problem: when debugging why a user can't access a resource, a developer must check both the TypeScript `ProjectPolicy` and the PostgreSQL `pg_policies`. To keep this manageable, follow a strict division of responsibility:

| Concern | Where It Lives | Why |
| --- | --- | --- |
| **Tenant isolation** (user can only see their own rows) | Database RLS | Enforced even if application code has a bug. Simple `user_id = auth.uid()` predicates. |
| **Role-based access** (admin vs viewer vs owner) | Application Policy classes | Complex logic that's easy to unit test without a database. |
| **State-based rules** (can't delete an active project) | Application Policy classes or Command handlers | Business logic that changes frequently and needs test coverage. |
| **Cross-tenant access** (support staff viewing a user's data) | Application Policy classes | Requires audit logging and explicit overrides — too complex for SQL policies. |

**The rule:** RLS policies should be simple, universal, and rarely change. If you find yourself writing `CASE WHEN` logic or subqueries in a PostgreSQL policy, that logic belongs in the Application layer instead.

This keeps RLS as a reliable safety net (it always filters by tenant) while keeping nuanced authorization in TypeScript where it can be unit tested in milliseconds and reviewed in pull requests.

---

## Unit of Work, Outbox, and Idempotency

These three patterns work together to keep data consistent and operations reliable. Let's understand each one.

### Unit of Work (UoW)

**The problem it solves:** When creating a project, you might need to:
1. Insert the project row.
2. Insert an outbox event.
3. Update a counter or index.

If step 2 fails after step 1 succeeds, your data is in an inconsistent state — the project exists but no event was recorded. The Unit of Work wraps all these operations in a single database transaction.

```ts
// src/server/uow/types.ts
export interface UnitOfWork {
  run<T>(ctx: AuthContext, fn: (tx: TransactionContext) => Promise<T>): Promise<T>;
}

export interface TransactionContext {
  db: TransactionClient;  // The transaction handle — all queries go through this
}
```

Note that `TransactionClient` is an abstraction (imported from `@/src/lib/tenant`), not a Drizzle-specific type. This means the UoW interface is ORM-agnostic — you could swap in a different database adapter without changing the handler code.

**How it works in practice:**

```ts
return deps.uow.run(ctx, async (tx) => {
  // Everything inside this callback uses the same transaction.
  // If ANY operation throws an error, ALL operations are rolled back.

  const project = await deps.projectRepo.create(tx, data);   // Insert 1
  await deps.outbox.enqueue(tx, event);                       // Insert 2
  await deps.idempotency.put(tx, key, result);                // Insert 3

  return result;
  // Transaction commits here (if no errors were thrown)
});
```

**Our UoW also does something special:** It sets `request.jwt.claims` at the start of the transaction, with `sub` set to the user's internal `principalId` (the `users.id` UUID). This tells PostgreSQL's `auth.uid()` function who the current user is, so RLS policies like `user_id = auth.uid()` are enforced automatically within the transaction scope.

This is the bridge between Supabase Auth (which provides the external identity) and our database security model (which uses our internal user ID). The `requireAuthContext()` function resolves the Supabase session to an `AuthContext` containing the `principalId`, and the UoW injects that identity into the database connection via `SET LOCAL request.jwt.claims`. You don't need to worry about this plumbing — it happens behind the scenes in `DrizzleUoW` and `DrizzleReadOnly`.

### Outbox Pattern

**The problem it solves:** You need to save data AND trigger async work (send an email, update a search index). But what if the save succeeds and the email service is down?

**The naive approach (DON'T do this):**
```ts
await db.insert(projects).values(data);  // Step 1: Save
await sendEmail(user.email, "Created!"); // Step 2: Send email
// What if step 2 fails? The project exists but the email was never sent.
// What if step 1 fails AFTER step 2? The email was sent for a project that doesn't exist!
```

**The outbox approach (DO this):**
```ts
await uow.run(ctx, async (tx) => {
  await projectRepo.create(tx, data);              // Save project
  await outbox.enqueue(tx, { type: "project.created", ... }); // Record intent
  // Both writes are in the same transaction — they succeed or fail together
});

// Later, a background worker picks up the outbox event and sends the email
```

The outbox table looks like this:

```sql
CREATE TABLE outbox (
  id UUID PRIMARY KEY,
  aggregate_type TEXT NOT NULL,     -- e.g., "project"
  aggregate_id UUID NOT NULL,       -- e.g., the project's ID
  event_type TEXT NOT NULL,          -- e.g., "project.created"
  payload JSONB NOT NULL,            -- event-specific data
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempt_count INT NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ,       -- when to retry
  status TEXT NOT NULL DEFAULT 'pending',  -- pending, processing, completed, dead-lettered
  idempotency_key TEXT,
  trace_id TEXT                      -- for log correlation
);
```

> 📌 _Implementation status:_ The outbox table and writer are fully implemented and integrated into the Unit of Work. Commands can enqueue events with versioned payloads for background processing.

### Event Contracts: Versioned Schemas for Outbox Payloads

Outbox events are an internal API. If a command handler changes the shape of a `project.created` payload but the background worker still expects the old shape, the worker will crash silently in the background — potentially days later when you're not watching.

**Treat outbox event payloads with the same discipline as HTTP API contracts:**

```ts
// src/events/project-events.ts
import { z } from "zod";

export const ProjectCreatedV1 = z.object({
  version: z.literal(1),
  projectId: z.string().uuid(),
  ownerId: z.string().uuid(),
  name: z.string(),
});

export const ProjectDeletedV1 = z.object({
  version: z.literal(1),
  projectId: z.string().uuid(),
  deletedBy: z.string().uuid(),
});

// Registry — single source of truth for all event shapes
export const EventSchemas = {
  "project.created.v1": ProjectCreatedV1,
  "project.deleted.v1": ProjectDeletedV1,
} as const;
```

**Validate before enqueuing:**

```ts
// In the command handler:
const payload = ProjectCreatedV1.parse({
  version: 1,
  projectId: record.id,
  ownerId: ctx.principalId,
  name: input.name,
});

await deps.outbox.enqueue(tx, {
  type: "project.created.v1",  // Versioned event type
  aggregateId: record.id,
  payload,
  traceId: ctx.traceId,
});
```

**Rules for event evolution:**
1. **Never modify an existing event schema.** If the shape needs to change, create a new version (`project.created.v2`).
2. **Workers declare which versions they handle.** A worker subscribing to `project.created.v1` won't receive `v2` events until it's updated.
3. **Keep old versions alive** until all consumers have migrated. Only then can you deprecate and eventually remove the old schema.
4. **Validate on both sides.** The command handler validates before enqueuing; the worker validates after dequeuing. This catches corruption and version mismatches early.

This prevents the most common failure mode of event-driven systems: silent contract drift between producers and consumers.

### Idempotency

**The problem it solves:** Network requests can fail and be retried. If a user clicks "Create Project" and their internet glitches, the browser might send the same request twice. Without idempotency, you'd create two projects.

**How it works:**

1. The client generates a unique key (like a UUID) and includes it in the request as `idempotencyKey`.
2. The handler checks: "Have I already processed this key?"
3. If yes → return the cached result (don't create a duplicate).
4. If no → process the request and cache the result.

```ts
// Inside the handler:
if (input.idempotencyKey) {
  const cached = await deps.idempotency.get(tx, input.idempotencyKey);
  if (cached) return cached;  // Same request → same result
}

// ... do the work ...

if (input.idempotencyKey) {
  await deps.idempotency.put(tx, input.idempotencyKey, result);
}
```

This is especially important for:
- Mobile apps with unreliable connections.
- Payment processing (you really don't want to charge someone twice).
- Any operation that creates resources.

### Worker Lifecycle

Background workers process outbox events:

1. Worker polls the database for `pending` rows where `next_attempt_at <= now()`.
2. Marks the row as `processing` using `FOR UPDATE SKIP LOCKED` — this SQL clause prevents two workers from picking up the same event.
3. Executes the action (send email, call webhook, index document).
4. **On success:** Sets status to `completed`.
5. **On failure:** Increments `attempt_count`, calculates the next retry time using **exponential backoff** (wait 1s, then 2s, then 4s, then 8s...), and sets `next_attempt_at`.
6. **After too many failures (default 10):** Marks as `dead-lettered` and sends an alert. A human needs to investigate.

**What's exponential backoff?** Instead of retrying immediately (which would hammer a failing service), you wait longer between each retry: 1 second, 2 seconds, 4 seconds, 8 seconds, etc. This gives the failing service time to recover.

---

## Observability

Observability means being able to understand what your application is doing in production. When something goes wrong at 3 AM, observability is the difference between "I have no idea what happened" and "I can see exactly which request failed and why."

### The Three Pillars

1. **Logs:** Textual records of what happened. "User X created project Y at time Z."
2. **Metrics:** Numerical measurements. "95th percentile response time is 200ms." "Error rate is 0.5%."
3. **Traces:** End-to-end request flows. "Request abc-123 went through auth → handler → database → outbox → response in 150ms."

### Trace IDs

Every request gets a unique `traceId` (a UUIDv4 via `crypto.randomUUID()`). This ID is:
- Generated by the route handler before any other work happens.
- Passed into `requireAuthContext(req, traceId)`, which embeds it in the `AuthContext`.
- Threaded through every handler, service call, and outbox event via the `AuthContext`.
- Included in every log message and UoW lifecycle event.
- Returned in error responses so clients can report it for debugging.

When a user reports "I got an error," you ask for the `traceId` from the error response, then search your logs for that ID. You'll see every step the request took, making diagnosis much faster.

### Structured Logging

```ts
// BAD: Unstructured log
console.log("Project created for user " + userId);

// GOOD: Structured log
logger.info({
  traceId: ctx.traceId,
  route: "POST /api/projects",
  userId: ctx.principalId,
  projectId: result.id,
  latencyMs: Date.now() - startTime,
  message: "Project created",
});
```

Structured logs are machine-readable JSON. This means you can search, filter, and aggregate them with tools like CloudWatch, Datadog, or Grafana — instead of trying to parse messy text strings with regex.

**Field conventions:** The only required field is `traceId` (for request correlation). Beyond that, include whatever fields are meaningful for the operation — `userId`, `projectId`, `latencyMs`, etc. There is no prescribed field list; use your judgement about what would help you diagnose issues at 3 AM.

**Security rule:** Never log sensitive data like passwords, tokens, or PII (personally identifiable information like email addresses or phone numbers).

### Current Implementation

Structured logging is already implemented in `src/lib/logger.ts` — a zero-dependency logger that wraps `console` methods:

- **JSON output in production** for machine parsing by CloudWatch, Datadog, etc.
- **Human-readable output in development** for easy scanning in the terminal.
- **`LOG_LEVEL` environment variable** controls verbosity: `debug | info | warn | error` (default: `info`).
- **`traceId` threading:** Generated by the transport layer (`crypto.randomUUID()`), passed into `requireAuthContext(req, traceId)`, threaded through `AuthContext`, and included in the error envelope returned to clients.
- **UoW lifecycle logging:** Transaction start, commit, and rollback events are logged at `debug` level, each tagged with the `traceId` for request correlation.

This means you can already trace a request from the route handler through auth resolution, handler execution, transaction lifecycle, and error response — all by searching for a single `traceId`.

---

## API Design and Error Handling

### The Error Envelope

Every error response follows the same format:

```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "You do not have permission to create projects",
    "traceId": "01234567-89ab-cdef-0123-456789abcdef"
  }
}
```

This consistency is important because clients (web app, mobile app, partner integrations) can rely on a single error-handling pattern.

### Error Mapping

_File: `src/server/errors.ts`_

```ts
export function handleAppError(err: unknown, traceId?: string) {
  if (err instanceof AppError) {
    return Response.json(
      { error: { code: err.code, message: err.message, details: err.details, ...(traceId && { traceId }) } },
      { status: err.status },
    );
  }
  // Zod validation errors, unexpected errors, etc. mapped similarly
}
```

This function lives in the transport layer and maps **domain errors** (which know nothing about HTTP) to **HTTP responses**. The handler throws a `ConflictError` (a domain concept), and the transport converts it to a 409 status code (an HTTP concept). The `traceId` is included in every error response so clients can report it for debugging.

### HTTP Status Code Cheatsheet

| Status | When to Use | Example |
| --- | --- | --- |
| 400 / 422 | Invalid input (Zod validation failed) | `{ name: 123 }` instead of `{ name: "valid string" }` |
| 401 | Not authenticated (no token or invalid token) | Request without a login session |
| 403 | Authenticated but not allowed | Regular user trying to access admin features |
| 404 | Resource not found (or hidden for security) | Accessing a project that belongs to another user |
| 409 | Conflict (duplicate data, stale version) | Creating a project with a name that already exists |
| 429 | Rate limited (too many requests) | Sending 1000 requests per second |
| 500 | Unexpected server error (a bug!) | Unhandled exception in the handler |

---

## Multi-Client Data Access

Our architecture supports multiple clients (web, mobile, partner APIs) accessing the same backend. Here's how.

### Typed API Client

Instead of each client calling `fetch()` directly, we provide a typed API client that validates both requests and responses:

```ts
// packages/api-client/src/projects.ts
export async function createProject(input: unknown, token: string) {
  const body = CreateProjectRequest.parse(input);  // Validate before sending
  const res = await fetch(`${BASE_URL}/api/projects`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(res.status, await res.text());
  return ProjectResponse.parse(await res.json());  // Validate the response too
}
```

**Why validate on the client side too?**

- **Request validation:** Catches mistakes early, before wasting a network round-trip.
- **Response validation:** Protects against server bugs or API version mismatches. If the server adds/removes a field, the client schema will catch it.

### TanStack Query Hooks

React components access data through TanStack Query hooks, which provide caching, automatic refetching, and optimistic updates:

```ts
// hooks/useProjects.ts
export function useProjects() {
  return useQuery({
    queryKey: ["projects"],         // Cache key — used for invalidation
    queryFn: () => api.listProjects(), // The actual API call
  });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.createProject,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
    // After creating a project, tell TanStack to refetch the project list
  });
}
```

**Rules:**
- Hooks never call `fetch()` directly — they always go through the typed API client.
- Query keys map 1:1 with handler DTOs. The `["projects"]` key corresponds to the `handleListProjects` handler's response shape.
- Mutations invalidate the relevant query keys so the UI stays in sync.

**What are optimistic updates?** When a user creates a project, instead of waiting for the server response to show it in the list, we immediately add it to the local cache with a "pending" status. If the server call succeeds, the real data replaces the optimistic entry. If it fails, we roll back the optimistic update. This makes the app feel instant.

---

## Choosing a Path: Standard vs Lightweight

Not every feature needs every architectural piece. We define two tiers:

### Tier A — Durable Flow (the full ceremony)

**Use when:** The feature involves shared data, handles money, is accessible from mobile/partner clients, has async side effects, or is compliance-sensitive.

**Includes everything:** Command/query handlers, Unit of Work, outbox, idempotency, policies, typed contracts, CI guardrails.

**Examples:** Creating projects, processing payments, uploading documents, user account management.

### Tier B — Lightweight Flow (the fast path)

**Use when:** Internal-only CRUD, prototypes behind feature flags, read-mostly admin pages without async work. Must be reversible and low risk.

**What you still need:**
- AuthContext resolution (always verify who the user is).
- Zod validation (always validate input).
- Policy check (even if it's simple, like "is the user active?").
- Unit of Work for writes (always use transactions).
- DTO responses (always return clean data).

**What you can skip:**
- Idempotency keys.
- Outbox events.
- Typed TanStack hooks (if the flow is web-only).

### The Promotion Rule

**If a Tier B feature ships to customers, gains async side effects, or needs mobile access, upgrade it to Tier A before releasing.**

This prevents the common trap of "we'll add the outbox later" turning into "it's been 6 months and we still fire-and-forget emails."

---

## Architecture Guardrails

These are the rules. Some are required for every feature; others depend on context.

| Rule | Why | Level |
| --- | --- | --- |
| Business logic lives in handlers, not routes/components | Keeps framework noise away from domain rules; enables reuse across clients | **Required** |
| Every write uses the Unit of Work | Ensures atomicity (all-or-nothing), consistent tracing, RLS claims | **Required** |
| Outbox is the only path for async effects | Prevents ghost writes when servers crash mid-request | **Required** (Tier A), **Conditional** (Tier B) |
| Route handlers under 40 lines | A long route handler signals logic leakage | **Required** |
| Policies enforce authorization | Resource-aware checks that are easy to audit and test | **Required** |
| Shared Zod contracts for API client + server | Prevents drift between clients and server | **Required** when API is shared |
| Idempotency keys on retry-prone commands | Makes network retries safe | **Required** for external clients, **Optional** for internal |
| Observability (traceId, structured logs) | Enables diagnosis when things go wrong at 3 AM | **Required** |
| TanStack hooks wrap the API client | Unified caching and error handling | **Required** on shared hooks |
| Workers must handle duplicate delivery | Guarantees exactly-once semantics | **Required** |

---

## Testing Strategy

Different layers need different testing approaches:

| What to Test | How to Test It | Dependencies Needed |
| --- | --- | --- |
| **Policies / domain rules** | Test happy paths ("admin can create") and sad paths ("viewer cannot delete") | Pure functions — no database, no network |
| **Command handlers** | Test validation (bad input rejected), policies (unauthorized blocked), transaction orchestration, outbox writes | Fake repos, fake UoW, spy outbox |
| **Query handlers** | Test filter logic, DTO mapping, pagination cursors | Fake query services or a test database |
| **Repositories/services** | Test that SQL queries return correct data, constraints are enforced | Real test database |
| **Contracts** | Snapshot tests to catch schema changes | Zod tests |
| **Transport** | Test request parsing, status code mapping | Mock handlers |
| **Workers** | Test retry math, duplicate detection, dead-letter queue paths | Fake outbox + fake third-party services |
| **End-to-end** | Test critical user flows from auth through CRUD to side effects | Full stack (real database, real services) |

### Testing Best Practices for This Architecture

1. **Test handlers, not routes.** Since route handlers are just thin wrappers, testing the handler directly is faster and more valuable.
2. **Use fakes, not mocks.** Instead of mocking the database, create an `InMemoryProjectRepository` that stores data in a Map. Fakes are more realistic and easier to maintain than mock setups.
3. **Run integration tests against a real database.** For repository/service tests, use a real PostgreSQL instance. Our test setup includes helpers like `createTestUser()` and `cleanupTestData()`.

---

## Decision Guides

When should you use one approach vs. another? These guides help you choose.

### Server Components vs TanStack Query

| Use Server Components when... | Use TanStack Query when... |
| --- | --- |
| You're rendering the initial page load and want fast SSR | You need interactive dashboards with real-time updates |
| The data is SEO-sensitive (search engines need to see it) | You need optimistic updates (instant UI feedback) |
| The data never changes on the client side | Multiple components share the same data cache |
| You want to reduce JavaScript bundle size | You need automatic retry, refetch on focus, or polling |

### Server Actions vs Route Handlers

| Use Server Actions when... | Use Route Handlers when... |
| --- | --- |
| It's a web-only form submission | Mobile or partner clients need to call it |
| It's an internal admin tool | You need a versioned public API |
| You want progressive enhancement (forms work without JS) | You're building webhooks or CLI endpoints |

### Repository vs Query Service

| Use a Repository when... | Use a Query Service when... |
| --- | --- |
| You're doing transactional writes (create, update, delete) | You're doing read-only operations |
| You're working with a single entity and its invariants | You need joins across multiple tables |
| You want an ORM-agnostic interface | You need performance-optimized views |
| The operation is part of a Unit of Work | You're integrating with search (e.g., Elasticsearch) |

---

## Async Worker Details

Workers are background processes that handle async work from the outbox.

### Deployment

Workers run as separate Bun processes (or AWS Lambda functions) that read from the same PostgreSQL database as the web app. They don't share the Node.js process with Next.js — they're independent.

### Configuration

All configuration comes from environment variables, accessed through `src/lib/config.ts`. This includes:
- **Batch size:** How many outbox events to process per poll.
- **Max attempts:** How many retries before dead-lettering (default: 10).
- **Poll interval:** How often to check for new events (e.g., every 5 seconds).

### Duplicate Safety

Workers maintain a `processed_events` table keyed by `(event_type, aggregate_id, payload_hash)`. This ensures that even if a worker crashes and restarts, it won't process the same event twice. This is called **exactly-once semantics**.

### Alerting

- **Pager:** When `outbox.pending` exceeds 5,000 rows (the queue is backing up) or `worker.heartbeat` is missing for 2 intervals (the worker might have crashed).
- **Slack notification:** When an event enters the dead-letter queue, with a payload preview for quick diagnosis.

### Long-Running Workloads (GraphRAG, Analytics, etc.)

Some features need heavy processing — AI embeddings, nightly reports, ML pipelines. These are handled separately from the main outbox worker:

1. **Triggering:** Commands emit events to the outbox. A "batch orchestrator" service subscribes to these events.
2. **Orchestration:** The batch worker pulls jobs in chunks, saves progress checkpoints, and distributes work across compute resources.
3. **Independence:** Batch processors have their own retry logic and metrics. They never hold up the interactive outbox worker.
4. **Back-pressure:** If processing falls behind, we rate-limit at the source — not by skipping outbox writes.

> 📌 _Implementation status:_ We run complex GraphRAG and medical extraction pipelines. These are triggered via the outbox and orchestrated by Lambdas that coordinate long-running async work.

---

## Future Developments: Scaling the Architecture

This section documents architectural patterns that aren't needed today but become valuable as the application (or future projects) grow in complexity. Each pattern includes clear signals for when to adopt it — introducing them too early adds unnecessary complexity, but waiting too long creates painful migrations.

### From Transaction Scripts to Domain Entities

**What we do today:** Business rules live in command handlers as procedural logic — validate input, check for duplicates, save the record. This is the "Transaction Script" pattern. The data objects returned by services are simple rows with no behavior attached.

**When this breaks down:** When business rules become complex enough that handlers start bloating with nested conditionals, state machine logic, and cross-cutting validations. Signs include:
- A single handler exceeds 100 lines of business logic (not counting imports or setup).
- The same state transition rules are duplicated across multiple handlers.
- Business rules require combining data from several entities to make a decision.

**What to adopt:** Push behavior into pure TypeScript **Domain Entities** — classes that encapsulate both data and the rules that govern it:

```ts
// Instead of the handler checking state transitions:
class Project {
  constructor(private data: ProjectRow) {}

  transitionTo(newStatus: ProjectStatus): void {
    const allowed = PROJECT_TRANSITIONS[this.data.status];
    if (!allowed?.includes(newStatus)) {
      throw new ConflictError(
        `Cannot transition from ${this.data.status} to ${newStatus}`
      );
    }
    this.data.status = newStatus;
    this.data.updatedAt = new Date();
  }

  get snapshot(): ProjectRow { return { ...this.data }; }
}

// Handler becomes:
const project = new Project(await deps.projectRepo.findById(tx, id));
project.transitionTo(input.status);  // Throws if invalid
await deps.projectRepo.save(tx, project.snapshot);
```

**For this project:** The current domains (projects, meetings, chat) are simple CRUD. Transaction scripts are the right choice today. Revisit when a domain accumulates 3+ business rules that interact with each other.

**For future projects:** If you know a domain will be complex from the start (billing, workflow engines, multi-party approvals), begin with domain entities from day one.

### From Raw Rows to Domain Models

**What we do today:** Services return Drizzle row types directly — the exact shape of database columns. Handlers work with these rows, and DTOs are constructed from them.

**When this breaks down:** When a database column rename, type change, or table split forces changes in handlers that shouldn't care about storage details. Signs include:
- A column rename (`description` → `summary`) requires changes in 10+ handler files.
- A denormalization or table split (extracting `project_settings` into its own table) breaks handler logic.
- Multiple representations of the same entity exist across different query services with inconsistent shapes.

**What to adopt:** Repositories map database rows to clean **Domain Model interfaces** before returning them:

```ts
// Domain model — decoupled from database columns
interface Project {
  id: string;
  name: string;
  summary: string;        // Maps to DB column "description"
  status: ProjectStatus;
  createdAt: Date;
}

// Repository handles the mapping
class DrizzleProjectRepository {
  async findById(tx: TransactionClient, id: string): Promise<Project> {
    const row = await tx.select().from(projects).where(eq(projects.id, id));
    return {
      id: row.id,
      name: row.name,
      summary: row.description,  // Mapping happens here, once
      status: row.status as ProjectStatus,
      createdAt: row.created_at,
    };
  }
}
```

**For this project:** The database schema is stable and the entity count is small. Direct Drizzle row types are pragmatic. Add the mapping layer when you perform your first column rename or table restructure that touches more than 3 files.

**For future projects:** If you anticipate the storage model diverging from the domain model early (e.g., using a document database for some entities, or integrating with external data sources), start with the mapping layer.

### From Outbox Polling to Change Data Capture (CDC)

**What we do today (target architecture):** A background worker polls the outbox table on a fixed interval using `FOR UPDATE SKIP LOCKED` to claim events for processing.

**Why polling is fine for now:** `FOR UPDATE SKIP LOCKED` is a robust concurrency primitive. With a 5-second poll interval and a few thousand events per day, the database overhead is negligible. Multiple workers can run in parallel without coordination. This pattern handles significant scale — tens of thousands of events per hour — before becoming a bottleneck.

**When polling breaks down:** At very high throughput, continuous polling creates unnecessary database load and introduces latency equal to the poll interval (events aren't processed until the next poll cycle). Signs include:
- The outbox table consistently has 10,000+ pending rows despite healthy workers.
- Poll queries account for a measurable percentage of database CPU.
- The poll interval (e.g., 5 seconds) is too slow for your latency requirements.
- You need sub-second event delivery.

**What to adopt:** Migrate from polling to **Change Data Capture (CDC)** — a pattern where the database streams new outbox rows directly to a message broker as they're inserted, with zero polling overhead:

| Approach | Mechanism | Latency | Infrastructure |
| --- | --- | --- | --- |
| **Polling** (current) | `SELECT ... FOR UPDATE SKIP LOCKED` on a timer | Poll interval (1-10s) | None beyond PostgreSQL |
| **LISTEN/NOTIFY** | PostgreSQL notifies workers of new rows | Sub-second | None beyond PostgreSQL |
| **Logical replication** | PostgreSQL WAL streams inserts to consumers | Sub-second | Requires replication slot management |
| **CDC with Debezium** | Debezium reads the WAL and publishes to Kafka/SQS | Sub-second | Kafka/SQS + Debezium + connector infrastructure |

**Recommended migration path:**

1. **Start with polling** (where we are). Simple, no infrastructure overhead, works for 99% of applications.
2. **Add `LISTEN/NOTIFY`** when you need lower latency without new infrastructure. Workers sleep until notified instead of polling on a timer. Falls back to polling if a notification is missed (they're not guaranteed delivery).
3. **Move to CDC** (Debezium or PostgreSQL logical replication) when you need guaranteed sub-second delivery at scale, event fan-out to multiple independent consumers, or integration with a broader event-driven ecosystem (Kafka, EventBridge, etc.).

**For this project:** Polling is the right choice. Revisit if throughput exceeds 10,000 events/hour or if sub-second delivery becomes a requirement.

**For future projects:** If the application is event-driven from inception (e.g., real-time collaboration, IoT, financial transactions), consider starting with `LISTEN/NOTIFY` and planning the CDC infrastructure early.

### API Versioning

**What we do today:** All API routes live under `app/api/v1/`. The `next.config.ts` rewrites map `/api/*` → `/api/v1/*` for backwards compatibility. Client hooks use the unversioned `/api/*` paths.

**Why this matters:** When mobile clients or partner integrations depend on your API, breaking changes become expensive. The versioned route structure means you can introduce `/api/v2/projects` with a new response shape while `/api/v1/projects` continues to serve existing clients unchanged.

**Rules for versioning:**
1. **Non-breaking changes** (adding optional fields, new endpoints) can go into the current version.
2. **Breaking changes** (removing fields, changing types, restructuring responses) require a new version.
3. **Deprecation:** When a new version ships, mark the old version as deprecated with a sunset date. Log warnings when deprecated endpoints are called.
4. **Client migration:** Update client hooks to use versioned paths (`/api/v1/*`) before introducing v2, so the rewrite rules can be removed cleanly.

---

## New Feature Checklist

Before marking a feature as done, verify every item:

1. [ ] **Choose Tier A or Tier B** and note it in the PR description.
2. [ ] **Handler created** under `server/commands` or `server/queries`.
3. [ ] **Handler signature** is `(deps, rawInput, ctx)` with no framework imports.
4. [ ] **Zod schemas** exist for request and response (and live in `contracts` if shared).
5. [ ] **Policy** function enforces authorization.
6. [ ] **Unit of Work** wraps all writes; read handlers use `readOnly` executor.
7. [ ] **Outbox + idempotency + versioned event schemas** wired up when required (Tier A).
8. [ ] **Route handler** stays under 40 lines and simply calls the handler.
9. [ ] **TanStack hook** (or Server Component) uses the typed API client when UI needs it.
10. [ ] **`traceId`** flows from transport through logs/outbox/errors.
11. [ ] **Tests** cover happy/sad paths for validation, policies, handlers, and schemas.
12. [ ] **Observability:** log message + metric for the new command/query + worker instrumentation if applicable.

If a box can't be checked, explain why in the PR and create a follow-up ticket.

---

## Appendix: Reference Tables

### Error Codes

| Code | When to Use |
| --- | --- |
| `UNAUTHORIZED` | No credentials, or the credentials are invalid |
| `FORBIDDEN` | A policy rejected access (the user is authenticated but not allowed) |
| `NOT_FOUND` | Resource missing, or it belongs to another tenant (hide its existence) |
| `CONFLICT` | Duplicate data, stale version, or concurrent update |
| `VALIDATION_ERROR` | Zod schema failed — the input doesn't match the expected shape |
| `RATE_LIMITED` | Too many requests — an upstream or internal rate limiter was triggered |
| `INTERNAL_ERROR` | An unexpected failure — this usually means there's a bug to fix |

### Metrics Minimums

Every production deployment should emit at least these metrics:

| Metric | What It Measures |
| --- | --- |
| `http.server.duration` | How long each request takes (broken down by route and status code) |
| `command.success` / `command.failure` | How many handler calls succeed vs. fail |
| `outbox.pending` | How many events are waiting to be processed (queue depth) |
| `worker.retry` | How many retries each event type is generating |
| `tanstack.cache.hit_ratio` | How often TanStack Query serves data from cache vs. making new requests |

These metrics, combined with structured logs and trace IDs, give you the visibility needed for on-call support and performance monitoring.

---

## Appendix: Worked Example — Document Upload + GraphRAG Pipeline

This example ties every concept together by walking through a realistic feature end-to-end: uploading a document, processing it with AI (GraphRAG), generating thumbnails, and keeping the UI updated throughout.

### The User Story

"As a user, I want to upload a document, have it automatically processed for GraphRAG knowledge extraction and thumbnail generation, and see the progress in real-time on my documents page."

### 1. Transport Layer (API Route)

_File: `app/api/v1/documents/route.ts`_

```ts
import { requireAuthContext } from "@/src/server/require-auth-context";
import { handleUploadDocument } from "@/src/server/commands/documents/upload-document";
import { handleAppError } from "@/src/server/errors";
import { makeDeps } from "@/src/server/make-deps";

export async function POST(req: Request) {
  const traceId = crypto.randomUUID();
  try {
    const ctx = await requireAuthContext(req, traceId);
    const body = await req.json();
    const result = await handleUploadDocument(makeDeps(), body, ctx);
    return Response.json(result, { status: 202 });  // 202 = "Accepted" (processing async)
  } catch (err) {
    return handleAppError(err, traceId);
  }
}
```

Notice the **202 status code** instead of 201. This tells the client: "I've accepted your request and started processing, but the work isn't done yet." This is the right status code for operations that trigger async processing.

### 2. Command Handler

_File: `src/server/commands/documents/upload-document.ts`_ (📌)

```ts
export async function handleUploadDocument(
  deps: DocumentDeps,
  rawInput: unknown,
  ctx: AuthContext,
) {
  const input = UploadDocumentInput.parse(rawInput);
  await deps.documentPolicy.assertCanUpload(ctx, input.folderId);

  return deps.uow.run(ctx, async (tx) => {
    // 1. Create the document record with "processing" status
    const doc = await deps.documentRepo.create(tx, {
      ownerId: ctx.principalId,
      name: input.name,
      s3Key: input.s3Key,
      status: "processing",      // Not "ready" yet — async work pending
      sizeBytes: input.sizeBytes,
    });

    // 2. Queue the async processing event
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

    // 3. Return the document ID + a pre-signed upload URL
    return {
      id: doc.id,
      presignedUrl: await deps.storage.signUploadUrl(input.s3Key),
      status: doc.status,
    };
  });
}
```

**What's a pre-signed URL?** Instead of uploading the file through our server (which is slow and expensive), we generate a temporary URL that lets the client upload directly to S3 (AWS storage). The URL expires after a short time and is scoped to a specific file — so it's secure.

### 3. Client Flow

The React app uses a TanStack mutation to handle the upload:

1. `useUploadDocument` mutation calls the API client.
2. On success, the hook adds an **optimistic cache entry** `{ id, name, status: "processing", thumbnails: [] }` — the document appears in the list immediately, before processing finishes.
3. The hook uploads the file binary to the `presignedUrl`.
4. `useDocuments` invalidates `["documents"]` so the server data replaces the optimistic entry once the handler commits.

### 4. Async Pipelines

Two workers consume the `document.uploaded` event:

1. **Thumbnail Worker** (`workers/thumbnail-worker.ts`):
   - Picks up `document.uploaded` from the outbox.
   - Downloads the file from S3.
   - Generates thumbnail images.
   - Stores thumbnails back in S3.
   - Updates the document's database row with thumbnail URLs.
   - Emits `document.thumbnails_ready`.

2. **GraphRAG Orchestrator** (`workers/graphrag-orchestrator.ts`):
   - Only processes events where `requiresGraphRag` is true.
   - Reads the document from S3 in chunks.
   - Builds embeddings and knowledge graph edges.
   - Stores results in the database.
   - Emits `document.graphrag_completed`.

Both workers log with the original `traceId`, so support can trace a user's upload through all the async processing stages.

### 5. UI Reconciliation

After the mutation invalidates the cache, TanStack Query refetches the documents list. Initially, the document shows as "processing." As background workers complete their tasks and update the database, subsequent fetches (or real-time events via SSE/WebSocket) update the list — thumbnails appear, status changes to "ready" — all without a page refresh.

### 6. Failure Handling

Every failure path is covered:

| Failure Point | What Happens |
| --- | --- |
| Upload fails before hitting S3 | Mutation rejects; optimistic cache entry is rolled back; user sees an error |
| Thumbnail processing fails | Worker retries with exponential backoff; after max attempts, marks `document.processing_failed`; UI shows "failed" status with retry button |
| GraphRAG processing fails | Same retry + dead-letter pattern; user can retry or disable GraphRAG for that document |
| Worker crashes mid-processing | `FOR UPDATE SKIP LOCKED` prevents duplicate processing; the event returns to "pending" and is picked up again |

**Metrics to monitor for this feature:**
- `document.upload.request_duration` — how long the initial upload request takes.
- `outbox.pending` for document events — how backed up the queue is.
- `graphrag.lag_ms` — how long documents wait before GraphRAG processing starts.
- `thumbnail.success_rate` — what percentage of thumbnails are generated successfully.

---

## Glossary

| Term | Definition |
| --- | --- |
| **Aggregate** | A cluster of related domain objects (e.g., a Project and its settings) that are treated as a single unit for data changes. |
| **AuthContext** | An object containing the authenticated user's identity, roles, and trace ID. Created by `requireAuthContext()`. |
| **CDC (Change Data Capture)** | A pattern where the database streams changes (inserts, updates, deletes) to external consumers in real time, eliminating the need for polling. See [Future Developments](#future-developments-scaling-the-architecture). |
| **Command** | An operation that changes data (create, update, delete). Handled by command handlers in `src/server/commands/`. |
| **Composition Root** | The single place (`makeDeps()`) where all concrete implementations are wired together. |
| **CQRS** | Command Query Responsibility Segregation — separating read and write operations into different handlers. |
| **Dead-Letter Queue (DLQ)** | Where failed events go after too many retry attempts. Requires manual investigation. |
| **Dependency Injection** | Passing dependencies (database, services) to a function instead of importing them directly. Makes testing easy. |
| **Domain Entity** | A class that encapsulates both data and the business rules that govern it (e.g., `Project.transitionTo()`). Contrast with anemic data objects that have no behavior. See [Future Developments](#future-developments-scaling-the-architecture). |
| **Domain Model** | An interface that represents a business concept, decoupled from its database storage format. Repositories map database rows to domain models. See [Future Developments](#future-developments-scaling-the-architecture). |
| **DTO** | Data Transfer Object — a clean data shape sent between layers or to clients. Never expose raw database rows. |
| **Exponential Backoff** | A retry strategy where wait times increase exponentially: 1s, 2s, 4s, 8s, etc. |
| **Idempotency** | The property of an operation where calling it multiple times produces the same result as calling it once. |
| **Lazy Getter** | A JavaScript property defined with `get` that defers object construction until first access. Used in the composition root to avoid creating unused dependencies. |
| **Optimistic Update** | Updating the UI immediately (before the server confirms), then reconciling with the real data. |
| **Outbox Pattern** | Recording async side effects in the same transaction as the primary write, then processing them later. |
| **Policy** | An object or class that encapsulates authorization logic: "Is this user allowed to do this action?" |
| **Query** | An operation that reads data without modifying it. Handled by query handlers in `src/server/queries/`. |
| **RLS** | Row-Level Security — a PostgreSQL feature that restricts which rows a user can see based on policies defined in the database. |
| **Transaction** | A group of database operations that either all succeed or all fail together (atomicity). |
| **Transaction Script** | A pattern where business logic is written as procedural code in a handler function, rather than encapsulated in domain entity classes. Appropriate for simple CRUD operations. |
| **Transport Layer** | The outermost layer that receives HTTP requests and returns responses. Route handlers and Server Actions live here. |
| **Unit of Work (UoW)** | A pattern that groups database writes into a single transaction. Ensures consistency. |

---

_This architecture keeps layers strict, surfaces operational detail (workers, observability), and offers an explicit lighter path for small CRUD — staying pragmatic without sacrificing reliability._
