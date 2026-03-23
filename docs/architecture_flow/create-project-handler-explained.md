# create-project.ts (Command Handler) — Line-by-Line Explanation

**File:** `src/server/commands/projects/create-project.ts`

This is the **handler layer** for creating a project. It sits between the transport layer (the API route) and the service layer (the database operations). Its job: validate input, open a transaction via the UoW, and call the service to do the actual insert.

This is the shortest file in the chain — and that's by design. Handlers should be thin orchestrators, not dumps for business logic.

---

## Lines 1–4: Imports

```typescript
import { z } from "zod";
```
Zod v4 — the validation library. Used to define and enforce the input schema. If the input doesn't match, `z.parse()` throws a `ZodError`, which `handleAppError` in the route handler catches and maps to a 400 response with field-level error details.

```typescript
import type { AuthContext } from "../../auth-context";
```
The `{ principalId, supabaseId, email, roles }` type produced by auth resolution. The handler uses `ctx.principalId` as the `userId` for the new project.

```typescript
import type { UnitOfWork } from "../../uow/types";
```
The UoW interface (not the concrete `DrizzleUoW`). The handler depends on the abstraction, not the implementation. This is the Dependency Inversion Principle — the handler doesn't know or care whether it's a real Drizzle transaction or a fake in-memory one (useful for testing).

```typescript
import { createProject } from "@/src/services/project-service";
```
The service function that does the actual database insert. The handler calls this inside the UoW transaction.

---

## Lines 6–10: Input Schema

```typescript
export const CreateProjectInput = z.object({
  name: z.string().min(1, "Name is required").max(200),
  description: z.string().max(2000).optional(),
  status: z.enum(["active", "draft", "completed", "archived"]).optional(),
});
```
The Zod schema that defines valid input for creating a project. This is the **single source of truth** for what the API accepts. It's exported so tests can import and reference it.

### Field-by-field:

**`name: z.string().min(1, "Name is required").max(200)`**
- Must be a string
- Must be at least 1 character (empty string rejected)
- Must be at most 200 characters
- If validation fails, the error message says "Name is required" (for min) or uses Zod's default message (for max)

**`description: z.string().max(2000).optional()`**
- If provided, must be a string of at most 2000 characters
- `.optional()` means the field can be omitted entirely (it will be `undefined`)
- Not the same as nullable — if the field is present, it must be a string, not `null`

**`status: z.enum(["active", "draft", "completed", "archived"]).optional()`**
- If provided, must be exactly one of these four values
- Any other string (like `"deleted"` or `"Active"`) is rejected
- `.optional()` means it defaults to `undefined`, and the service layer defaults it to `"active"`

### What happens when validation fails:

Zod throws a `ZodError` containing an `issues` array. For example, if `name` is missing:
```json
{
  "issues": [
    {
      "code": "too_small",
      "minimum": 1,
      "message": "Name is required",
      "path": ["name"]
    }
  ]
}
```

This error propagates up to the route handler's `catch` block, where `handleAppError` detects it (via `"issues" in err`) and returns:
```json
HTTP 400
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Name is required",
    "details": [{ "code": "too_small", "minimum": 1, "message": "Name is required", "path": ["name"] }]
  }
}
```

---

## Lines 12–22: The Handler Function

```typescript
export async function handleCreateProject(
  deps: { uow: UnitOfWork },
  rawInput: unknown,
  ctx: AuthContext
) {
```
The handler function signature. Three parameters, always in the same order for all handlers:

**`deps: { uow: UnitOfWork }`** — The dependencies this handler needs. It only destructures `uow` from the full `Deps` object. This makes the dependency requirement explicit — you can see at a glance that this handler writes data (it uses `uow`, not `readOnly`).

**`rawInput: unknown`** — The unvalidated request body, typed as `unknown`. This forces the handler to validate it before using it — you can't access properties on `unknown` without a type guard or assertion. The Zod parse on the next line is that type guard.

**`ctx: AuthContext`** — The authenticated user, already validated by `requireAuthContext`. The handler uses `ctx.principalId` to set the `userId` on the new project.

```typescript
  const input = CreateProjectInput.parse(rawInput);
```
**Validate and type-narrow the input.** `parse()` does two things:
1. **Validates** — Checks that `rawInput` matches the schema. Throws `ZodError` if not.
2. **Returns typed data** — The return type is `{ name: string; description?: string; status?: "active" | "draft" | "completed" | "archived" }`. TypeScript now knows the exact shape.

After this line, `input` is safe to use. All fields are the correct types, within length limits, and status is one of the allowed values.

```typescript
  return deps.uow.run(ctx, async ({ db: tx }) => {
    return createProject(tx, ctx.principalId, input);
  });
}
```
**Run the operation inside a UoW transaction.** This single statement does a lot:

1. **`deps.uow.run(ctx, ...)`** — Opens a database transaction, sets `request.jwt.claims` so `auth.uid()` returns `ctx.principalId`, sets a 30-second statement timeout.

2. **`async ({ db: tx }) =>`** — The callback receives the transaction context. `{ db: tx }` destructures `db` and renames it to `tx` for readability (a common convention for transaction handles).

3. **`createProject(tx, ctx.principalId, input)`** — Calls the service layer to insert the project. Three arguments:
   - `tx` — The transaction handle, so the insert is part of the transaction
   - `ctx.principalId` — The internal user UUID, becomes the `user_id` foreign key
   - `input` — The validated input `{ name, description?, status? }`

4. **`return`** — The return value of `createProject` (the inserted project row) bubbles up through:
   - `uow.run()` commits the transaction and returns it
   - `handleCreateProject` returns it
   - The route handler wraps it in `Response.json(result, { status: 201 })`
   - `apiFetch` on the client receives it
   - TanStack Query puts it in the cache

### What this handler does NOT do (and where it happens instead):

| Concern | Where |
|---|---|
| Parse HTTP request | Route handler (`route.ts`) |
| Check authentication | `requireAuthContext` (before handler is called) |
| Open/commit/rollback transaction | UoW (`DrizzleUoW.run`) |
| Set tenant identity for RLS | UoW (`SET LOCAL request.jwt.claims`) |
| Execute the SQL INSERT | Service layer (`createProject`) |
| Format the HTTP response | Route handler (`Response.json`) |
| Map errors to HTTP status codes | `handleAppError` in route handler's catch block |

The handler's job is strictly: **validate input, orchestrate the transaction, call the service**. Three lines of actual logic.
