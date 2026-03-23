# app/api/projects/route.ts — Line-by-Line Explanation

**File:** `app/api/projects/route.ts`

This is a **transport layer** file — an API route handler in Next.js App Router. Its job is to receive HTTP requests, wire them to the correct handler, and return HTTP responses. It contains zero business logic.

Next.js maps this file to the URL `/api/projects` based on its path inside the `app/` directory. The filename `route.ts` tells Next.js this is an API route (not a page).

---

## Lines 1–5: Imports

```typescript
import { requireAuthContext } from "@/src/server/require-auth-context";
```
The auth resolution function. Takes a `Request`, extracts the user's identity from their Supabase session cookie (web) or Bearer token (mobile), and returns an `AuthContext` object containing `principalId`, `supabaseId`, `email`, and `roles`. Throws `UnauthorizedError` (401) if no valid session exists, or `ForbiddenError` (403) if the account is suspended/deleted.

```typescript
import { handleCreateProject } from "@/src/server/commands/projects/create-project";
```
The **command handler** for creating a project. Lives in `src/server/commands/` because it mutates data (a "write" operation). This handler validates the input with Zod, opens a UoW transaction, and calls the project service to insert a row.

```typescript
import { handleListProjects } from "@/src/server/queries/projects/list-projects";
```
The **query handler** for listing projects. Lives in `src/server/queries/` because it only reads data. This handler validates the query parameters with Zod and calls the project service to fetch matching rows.

```typescript
import { handleAppError } from "@/src/server/errors";
```
The centralised error-to-HTTP-response mapper. Takes any thrown error and converts it to a properly formatted JSON response:
- `UnauthorizedError` → 401
- `ForbiddenError` → 403
- `NotFoundError` → 404
- `ConflictError` → 409
- `ValidationError` → 400
- Zod validation errors → 400 (detected via `"issues" in err`, not `instanceof`)
- Anything else → 500

All error responses follow the same envelope shape: `{ error: { code, message, details? } }`.

```typescript
import { makeDeps } from "@/src/server/make-deps";
```
The **composition root**. Returns a singleton object `{ uow: DrizzleUoW, readOnly: DrizzleReadOnly }` — the dependencies that handlers need. This is where dependency injection happens. In a larger app, this would also wire up repositories, policy objects, and outbox writers. In Mayfly, handlers only need the UoW (for writes) and ReadOnly (for reads).

---

## Lines 7–20: GET Handler (List Projects)

```typescript
export async function GET(req: Request) {
```
Next.js App Router convention: exporting a function named `GET` makes it handle HTTP GET requests at this route's URL (`/api/projects`). The function receives the standard Web API `Request` object.

```typescript
  try {
```
Wraps everything in try/catch so any thrown error is caught and converted to an HTTP response by `handleAppError`. Without this, an unhandled error would result in a generic 500 with no useful body.

```typescript
    const ctx = await requireAuthContext(req);
```
**Step 1: Authenticate.** Extracts the user's identity from the request. After this line, `ctx` contains:
```typescript
{
  principalId: "internal-uuid",    // users.id — used for all data access
  supabaseId:  "supabase-uuid",    // Supabase auth ID — not used after this point
  email:       "user@example.com",
  roles:       []
}
```
If the user is not logged in, this throws `UnauthorizedError` and execution jumps to the `catch` block, which returns a 401 response. If the account is suspended/deleted, it throws `ForbiddenError` → 403.

```typescript
    const url = new URL(req.url);
```
Parses the request URL so we can extract query parameters. For example, if the request is `GET /api/projects?search=foo&status=active`, this gives us access to `search` and `status`.

```typescript
    const result = await handleListProjects(
      makeDeps(),
      Object.fromEntries(url.searchParams),
      ctx
    );
```
**Step 2: Call the query handler.** Three arguments:

1. `makeDeps()` — The dependencies object. The list-projects handler uses `deps.readOnly` to run its query inside a read-only transaction (which sets `auth.uid()` for RLS and prevents accidental writes).

2. `Object.fromEntries(url.searchParams)` — Converts the URL search params into a plain object. For `?search=foo&status=active`, this produces `{ search: "foo", status: "active" }`. This is passed as the raw (unvalidated) input — the handler will validate it with Zod.

3. `ctx` — The authenticated user context. The handler uses `ctx.principalId` to filter projects to only this user's data.

Inside the handler, the flow is:
- Zod validates the search/status/limit/offset params
- `deps.readOnly.run(ctx, ...)` opens a read-only transaction and sets `request.jwt.claims` so `auth.uid()` works
- `listProjects(tx, userId, options)` runs the Drizzle query with `WHERE user_id = userId`

```typescript
    return Response.json(result);
```
**Step 3: Return the response.** `Response.json()` is a Web API static method that creates a `Response` with:
- The result serialised as JSON body
- `Content-Type: application/json` header
- Status 200 (default)

The `result` object looks like: `{ projects: [...], total: 42 }`.

```typescript
  } catch (err) {
    return handleAppError(err);
  }
```
**Error path.** If anything in the try block throws, `handleAppError` converts it to the appropriate HTTP response. This is why the route handler never needs to check for specific error types — the centralised error handler does it.

---

## Lines 22–31: POST Handler (Create Project)

```typescript
export async function POST(req: Request) {
```
Handles HTTP POST requests at `/api/projects`. Same Next.js convention as GET.

```typescript
  try {
    const ctx = await requireAuthContext(req);
```
**Step 1: Authenticate.** Same as the GET handler — extract and validate the user's identity. Unauthenticated → 401, suspended/deleted → 403.

```typescript
    const body = await req.json();
```
**Step 2: Parse the request body.** Reads the raw JSON body from the request. This is the unvalidated input — something like `{ name: "My Project", description: "..." }`. No validation happens here; that's the handler's job.

`req.json()` is a Web API method that reads the body stream and parses it as JSON. It throws if the body isn't valid JSON (which would be caught by the `catch` block and mapped to a 500).

```typescript
    const result = await handleCreateProject(makeDeps(), body, ctx);
```
**Step 3: Call the command handler.** Three arguments:

1. `makeDeps()` — The dependencies object. The create-project handler uses `deps.uow` to run its work inside a read-write transaction.

2. `body` — The raw, unvalidated request body. Inside the handler:
   - `CreateProjectInput.parse(body)` validates with Zod (name required, 1–200 chars; description optional, max 2000 chars; status must be one of active/draft/completed/archived)
   - If validation fails, Zod throws → `handleAppError` maps it to a 400 with field-level error details

3. `ctx` — The authenticated user context. The handler uses `ctx.principalId` as the `userId` foreign key on the new project row.

Inside the handler, the flow is:
- Zod validates the input
- `deps.uow.run(ctx, ...)` opens a transaction, sets `request.jwt.claims` for RLS, sets a 30-second timeout
- `createProject(tx, ctx.principalId, input)` runs `INSERT INTO projects ... RETURNING *`
- If anything throws, the transaction rolls back automatically
- If everything succeeds, the transaction commits and the new project row is returned

```typescript
    return Response.json(result, { status: 201 });
```
**Step 4: Return the response.** Returns the newly created project as JSON with HTTP status **201 Created** (not 200). The `{ status: 201 }` second argument sets this explicitly. The result object is the full project row from the database, including the generated `id`, `createdAt`, and `updatedAt`.

```typescript
  } catch (err) {
    return handleAppError(err);
  }
```
**Error path.** Same centralised error handling. Common errors from this path:
- Invalid JSON body → 500 (from `req.json()`)
- Zod validation failure → 400 with field details
- User not authenticated → 401
- Account suspended/deleted → 403
- Database constraint violation → 500
- Transaction timeout (>30s) → 500

---

## How This File Fits in the Architecture

```
┌──────────────────────────────────────────────────────┐
│  THIS FILE — Transport Layer                          │
│  app/api/projects/route.ts                            │
│                                                       │
│  Job: Parse HTTP, call handler, return Response       │
│  Rules:                                               │
│    • No business logic                                │
│    • No direct database access                        │
│    • No input validation (that's the handler's job)   │
│    • Always try/catch with handleAppError              │
├──────────────────────────────────────────────────────┤
│  Handler Layer                                        │
│  src/server/commands/projects/create-project.ts       │
│  src/server/queries/projects/list-projects.ts         │
│                                                       │
│  Job: Validate input, run business logic in UoW       │
├──────────────────────────────────────────────────────┤
│  Service Layer                                        │
│  src/services/project-service.ts                      │
│                                                       │
│  Job: Pure data access — INSERT, SELECT, UPDATE, etc. │
├──────────────────────────────────────────────────────┤
│  Database                                             │
│  PostgreSQL (Supabase) via Drizzle ORM                │
└──────────────────────────────────────────────────────┘
```

### What this route does NOT do (and why)

| Concern | Where it lives instead | Why |
|---|---|---|
| Input validation | Handler (Zod schemas) | Keeps validation rules with the business logic, not in the HTTP layer |
| Authorization (who can access what) | `requireAuthContext` + service-layer `userId` filtering + RLS policies | Defence in depth — three layers of access control |
| Transaction management | UoW (`DrizzleUoW`) | Handlers don't manage transactions directly; the UoW pattern ensures consistent begin/commit/rollback |
| Error formatting | `handleAppError` | Centralised, consistent error envelope across all routes |
| Database queries | Service layer (`project-service.ts`) | Services are reusable across handlers and testable in isolation |

### The pattern every route follows

```typescript
export async function METHOD(req: Request) {
  try {
    const ctx = await requireAuthContext(req);   // 1. Auth
    const input = /* extract from req */;         // 2. Parse HTTP
    const result = await handler(makeDeps(),      // 3. Delegate
                                 input, ctx);
    return Response.json(result, { status });     // 4. Respond
  } catch (err) {
    return handleAppError(err);                   // 5. Error
  }
}
```

Every API route in the app (`/api/projects`, `/api/meetings`, `/api/user`, etc.) follows this exact 5-step pattern. The only things that change are which handler is called and how the input is extracted from the request.
