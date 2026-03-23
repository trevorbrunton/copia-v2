# project-service.ts (Service Layer) — Line-by-Line Explanation

**File:** `src/services/project-service.ts`

This is the **service layer** — the bottom of the application code before the database. Service functions are pure data access: they receive a transaction handle, a user ID, and parameters, then execute SQL via Drizzle ORM. They contain no auth checks, no validation, no HTTP concerns.

Every service function follows the same signature pattern: `(tx, userId, ...) → result`.

---

## Lines 1–3: Imports

```typescript
import { eq, desc, ilike, and, sql } from "drizzle-orm";
```
Drizzle ORM query builder functions:

- **`eq(column, value)`** — Generates `column = value`. Used in WHERE clauses for exact matches.
- **`desc(column)`** — Generates `ORDER BY column DESC`. Used to sort by most recently updated.
- **`ilike(column, pattern)`** — Generates `column ILIKE pattern`. Case-insensitive pattern matching for search. PostgreSQL-specific.
- **`and(...conditions)`** — Combines multiple conditions with `AND`.
- **`sql`** — Tagged template for raw SQL fragments. Used for the `count(*)` aggregate.

```typescript
import { projects, type Project, type NewProject } from "@/src/db/schema";
```
The Drizzle table definition and its TypeScript types:

- **`projects`** — The table object. Drizzle uses this for type-safe queries. It knows the column names, types, and relationships.
- **`Project`** — The type of a row selected from the `projects` table (all columns, all required).
- **`NewProject`** — The type for inserting a new row (auto-generated columns like `id`, `createdAt`, `updatedAt` are optional).

```typescript
import type { TransactionClient } from "@/src/lib/tenant";
```
The Drizzle transaction type. This is what the UoW passes as the `tx` parameter. It's a database connection scoped to the current transaction — all queries through it are atomic.

---

## Lines 5–18: Types for `listProjects`

```typescript
interface ListProjectsOptions {
  search?: string;
  status?: string;
  limit?: number;
  offset?: number;
}
```
Optional filters and pagination for listing projects. All fields are optional — if none are provided, all the user's projects are returned (up to the default limit).

**`search`** — Case-insensitive substring match on the project name.
**`status`** — Filter by exact status value (e.g., `"active"`).
**`limit`** — Maximum number of rows to return. Defaults to 50.
**`offset`** — Number of rows to skip. For pagination — page 2 with limit 50 would use offset 50.

```typescript
interface ListProjectsResult {
  projects: Project[];
  total: number;
}
```
The return type. Includes both the page of results and the total count (needed for pagination UI — "Showing 1–50 of 127").

---

## Lines 20–49: `listProjects`

```typescript
export async function listProjects(
  tx: TransactionClient,
  userId: string,
  options: ListProjectsOptions = {}
): Promise<ListProjectsResult> {
```
**`tx: TransactionClient`** — The transaction handle from the UoW. All queries go through this, not the global `db`. This ensures the query runs inside the UoW's transaction where `auth.uid()` is set and `SET TRANSACTION READ ONLY` is active (for query handlers).

**`userId: string`** — The internal user UUID (`ctx.principalId`). Used to filter projects to only those belonging to this user.

**`options: ListProjectsOptions = {}`** — Default to empty object so callers can omit it.

```typescript
  const { search, status, limit = 50, offset = 0 } = options;
```
Destructure with defaults. If `limit` isn't provided, default to 50 rows. If `offset` isn't provided, start from the beginning.

```typescript
  const conditions = [eq(projects.userId, userId)];
```
**Start building the WHERE clause.** The first condition is always `user_id = userId` — this is the service-layer tenant isolation. Every query filters by the authenticated user's ID, so users can never see each other's data.

This is one of three layers of tenant isolation:
1. **This WHERE clause** (application layer)
2. **`auth.uid()` in RLS policies** (database layer, when enforced)
3. **The UoW setting `request.jwt.claims`** (connects the two)

```typescript
  if (status) {
    conditions.push(eq(projects.status, status));
  }
  if (search) {
    conditions.push(ilike(projects.name, `%${search}%`));
  }
```
**Add optional filters.** Only added to the WHERE clause if the caller provided them.

**`ilike(projects.name, \`%${search}%\`)`** — Case-insensitive LIKE match. The `%` wildcards mean "match anywhere in the name". So searching for `"proj"` matches `"My Project"`, `"Project X"`, `"PROJ-001"`.

Note: The `search` value is interpolated into the LIKE pattern string, but Drizzle parameterises it in the generated SQL, so this is safe from SQL injection.

```typescript
  const where = and(...conditions);
```
Combine all conditions with AND. If only `userId` was added, this is just `WHERE user_id = ?`. If all filters were provided, it's `WHERE user_id = ? AND status = ? AND name ILIKE ?`.

```typescript
  const [items, countResult] = await Promise.all([
    tx
      .select()
      .from(projects)
      .where(where)
      .orderBy(desc(projects.updatedAt))
      .limit(limit)
      .offset(offset),
    tx
      .select({ count: sql<number>`count(*)::int` })
      .from(projects)
      .where(where),
  ]);
```
**Run two queries in parallel** using `Promise.all`:

**Query 1: Fetch the page of results**
- `select()` — Select all columns
- `.from(projects)` — From the projects table
- `.where(where)` — Apply the filters
- `.orderBy(desc(projects.updatedAt))` — Most recently updated first
- `.limit(limit)` — At most N rows
- `.offset(offset)` — Skip the first M rows (pagination)

**Query 2: Count total matching rows**
- `select({ count: sql<number>\`count(*)::int\` })` — Select just the count
- `::int` — Cast from `bigint` to `int` so JavaScript gets a number, not a string
- Same `.where(where)` — Same filters, so the count matches the data query
- No `.limit()` or `.offset()` — We want the total count, not just the page count

Both queries run on the same transaction handle (`tx`), so they see the same data and participate in the same transaction.

```typescript
  return {
    projects: items,
    total: countResult[0]?.count || 0,
  };
}
```
**Return the results.** `countResult` is an array with one row; `[0]?.count` extracts the count value. Falls back to 0 if somehow there's no result (shouldn't happen, but defensive).

---

## Lines 51–64: `getProject`

```typescript
export async function getProject(
  tx: TransactionClient,
  userId: string,
  projectId: string
): Promise<Project | null> {
  const [project] = await tx
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1);

  return project || null;
}
```
Fetches a single project by ID, scoped to the authenticated user.

**`and(eq(projects.id, projectId), eq(projects.userId, userId))`** — Two conditions:
1. Match the project ID
2. Match the user ID

The second condition is critical — without it, a user could fetch any project by guessing its UUID. This is the service-layer access control.

**`const [project]`** — Destructure the first (and only) row. If no row matches both conditions, `project` is `undefined`.

**`return project || null`** — Convert `undefined` to `null` for a cleaner API. The caller can check `if (!project)` to handle not-found cases.

---

## Lines 66–80: `createProject`

```typescript
export async function createProject(
  tx: TransactionClient,
  userId: string,
  data: { name: string; description?: string; status?: string }
): Promise<Project> {
```
This is the function called in our traced create project flow.

**`data`** — The validated input from the handler. By this point, Zod has already checked that `name` is 1–200 chars, `description` is max 2000, and `status` is one of the allowed values. The service trusts its callers — it doesn't re-validate.

```typescript
  const [project] = await tx
    .insert(projects)
    .values({
      userId,
      name: data.name,
      description: data.description || null,
      status: data.status || "active",
    })
    .returning();

  return project;
}
```
**Insert a row and return it.**

**`.insert(projects)`** — Target the projects table.

**`.values({...})`** — The column values for the new row:
- `userId` — The internal user UUID from `ctx.principalId`. This becomes the `user_id` foreign key.
- `name: data.name` — The project name.
- `description: data.description || null` — If no description was provided (undefined), store `null`.
- `status: data.status || "active"` — If no status was provided, default to `"active"`.

Columns NOT specified (filled by database defaults):
- `id` — Auto-generated UUID via `gen_random_uuid()`
- `createdAt` — Defaults to `now()`
- `updatedAt` — Defaults to `now()`

**`.returning()`** — PostgreSQL-specific clause that returns the inserted row, including the generated `id` and timestamps. Without this, we'd need a separate SELECT to get the full row.

**`const [project]`** — Destructure the single inserted row from the result array.

**`return project`** — Returns the full row. This bubbles up through the UoW → handler → route → client.

---

## Lines 82–100: `updateProject`

```typescript
export async function updateProject(
  tx: TransactionClient,
  userId: string,
  projectId: string,
  data: Partial<Pick<NewProject, "name" | "description" | "status">>
): Promise<Project | null> {
```
**`Partial<Pick<NewProject, "name" | "description" | "status">>`** — A TypeScript utility type that means "an object with any subset of name, description, and status". You can pass `{ name: "New Name" }` or `{ status: "archived" }` or both — only the provided fields are updated.

```typescript
  const [updated] = await tx
    .update(projects)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .returning();

  return updated || null;
}
```
**`{ ...data, updatedAt: new Date() }`** — Spread the partial update data and always update the `updatedAt` timestamp. This ensures `updatedAt` reflects when the project was last modified, regardless of which fields changed.

**`.where(and(...))`** — Same dual condition as `getProject`: match both project ID and user ID. If the project doesn't exist or doesn't belong to this user, zero rows are updated and `updated` is `undefined`.

**`return updated || null`** — Returns the updated row, or `null` if nothing was updated (not found or wrong user).

---

## Lines 102–114: `deleteProject`

```typescript
export async function deleteProject(
  tx: TransactionClient,
  userId: string,
  projectId: string
): Promise<boolean> {
  const result = await tx
    .delete(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .returning();

  return result.length > 0;
}
```
**Hard delete** — Removes the row from the database entirely. No soft delete.

**`.returning()`** — Returns the deleted rows. We don't need the data, but checking `result.length` tells us whether a row was actually deleted.

**`return result.length > 0`** — Returns `true` if a row was deleted, `false` if not found (or wrong user). The handler/route can use this to return 404 if appropriate.

---

## How the Service Layer Fits in the Architecture

```
Handler Layer (create-project.ts)
  │
  │  deps.uow.run(ctx, async ({ db: tx }) => {
  │    return createProject(tx, ctx.principalId, input);
  │  });
  │
  ▼
Service Layer (project-service.ts)           ← THIS FILE
  │
  │  tx.insert(projects).values({...}).returning()
  │
  ▼
Drizzle ORM
  │
  │  INSERT INTO projects (user_id, name, ...) VALUES ($1, $2, ...) RETURNING *
  │
  ▼
PostgreSQL (Supabase)
  │
  │  RLS check: user_id = auth.uid()  ← enforced when using mayfly_app role
  │  Insert row, return it
  │
  ▼
Row returned up the chain → JSON response → client cache
```

### Key Design Points

1. **Services don't know about HTTP.** They never see `Request` or `Response`. They receive a transaction, a user ID, and typed parameters. This makes them reusable — the same `createProject` could be called from a CLI tool, a background job, or a test.

2. **Services don't validate input.** That's the handler's job. Services trust that their callers pass correct data. This avoids double validation.

3. **Services don't manage transactions.** They receive a `tx` and use it. The UoW decides when to begin, commit, or rollback. This means multiple service calls within one handler share the same transaction.

4. **Every query includes `userId` in its WHERE clause.** This is the application-level tenant isolation. Even if RLS were disabled (which it currently is, since the `postgres` role has BYPASSRLS), users still can't see each other's data because the services always filter by user.

5. **`.returning()` avoids extra SELECTs.** PostgreSQL's `RETURNING` clause returns the affected rows in the same statement. Without it, you'd need `INSERT` then `SELECT` — two round trips instead of one.
