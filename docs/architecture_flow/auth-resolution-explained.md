# Auth Resolution — Line-by-Line Explanation

This document explains the auth resolution process: how the app goes from an incoming HTTP request to a verified `AuthContext` that identifies who is making the request.

In the create project flow, this is the first thing that happens inside the route handler:

```typescript
const ctx = await requireAuthContext(req);
```

That one line triggers a chain across four files. This document traces every line in those files.

---

## File 1: `src/server/auth-context.ts`

The type definition for what auth resolution produces.

```typescript
export type AuthContext = {
  principalId: string;   // DB user.id (UUID)
  supabaseId: string;    // Supabase auth.uid()
  email: string;
  roles: string[];
};
```

### Line-by-line:

**`principalId: string`** — The internal database UUID (`users.id`). This is the ID used everywhere downstream: in service-layer WHERE clauses, as the `userId` foreign key on new rows, and as the `sub` claim in `request.jwt.claims` for RLS enforcement. This is the **only ID that matters** after auth resolution.

**`supabaseId: string`** — The Supabase Auth UUID. This is the ID Supabase assigns when the user signs up. It's stored in the `users.supabase_id` column but is not used anywhere after auth resolution — it's included in the context purely for logging or debugging.

**`email: string`** — The user's email address, read from the database (not from the auth token). Used by some handlers that need to display or reference the user's email.

**`roles: string[]`** — Currently always `[]` (empty array). Placeholder for future role-based access control. When implemented, this would contain values like `["admin"]` or `["manager"]` and be checked by policy objects.

---

## File 2: `src/auth/types.ts`

The type returned by the auth layer (before database lookup).

```typescript
export interface AuthUser {
  userId: string;
  email: string;
  name?: string;
}
```

**`userId`** — At this stage, this is the **Supabase auth UUID** (not the internal database ID). The naming is unfortunate — it's the auth provider's ID. It gets mapped to the internal `principalId` in the next step.

**`email`** — The email from the auth token.

**`name?`** — Optional display name from Supabase user metadata. Used when creating a new user record.

---

## File 3: `src/auth/server.ts`

Extracts the authenticated user from the HTTP request.

### Lines 1–3: Imports

```typescript
import { createClient } from "@supabase/supabase-js";
```
The Supabase client library. Used here to create a one-off client for Bearer token validation (mobile path).

```typescript
import { createServerSupabase } from "@/src/lib/supabase/server";
```
Creates a Supabase client that reads auth from Next.js cookies (web path). This client is pre-configured with the server-side cookie adapter from `@supabase/ssr`.

```typescript
import type { AuthUser } from "./types";
```
The `{ userId, email, name? }` type defined above.

### Lines 5–11: Helper function

```typescript
function toAuthUser(user: { id: string; email?: string; user_metadata?: Record<string, unknown> }): AuthUser {
  return {
    userId: user.id,
    email: user.email || "",
    name: user.user_metadata?.name as string | undefined,
  };
}
```

Converts a Supabase user object (which has many fields) into our minimal `AuthUser` shape.

**`userId: user.id`** — The Supabase auth UUID. Supabase returns this as `id` on their user object.

**`email: user.email || ""`** — Falls back to empty string if email is undefined. This shouldn't happen in practice since email is required for sign-up, but TypeScript's types mark it optional.

**`name: user.user_metadata?.name`** — Supabase stores custom profile data in `user_metadata`. The display name is stored there during sign-up. The `as string | undefined` cast is needed because `user_metadata` values are typed as `unknown`.

### Lines 16–22: Cookie auth (web)

```typescript
export async function getServerUser(): Promise<AuthUser | null> {
  const supabase = await createServerSupabase();
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) return null;
  return toAuthUser(user);
}
```

**`createServerSupabase()`** — Creates a Supabase client that reads the session from Next.js cookies. The `@supabase/ssr` library handles parsing the chunked auth cookies that Supabase stores.

**`supabase.auth.getUser()`** — Validates the session by calling Supabase's auth server. This is NOT just reading the JWT — it actually verifies the session is still valid (not expired, not revoked). Returns the full user object or an error.

**`if (error || !user) return null`** — No valid session → return null (which will become a 401 in `requireAuthContext`).

**`return toAuthUser(user)`** — Convert the Supabase user to our minimal shape.

### Lines 28–46: Request-based auth (web + mobile)

```typescript
export async function getServerUserFromRequest(
  request: Request
): Promise<AuthUser | null> {
```
This is the function that `requireAuthContext` calls. It handles both auth methods.

```typescript
  // Try Bearer token first (mobile)
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
```
**Check for a Bearer token.** Mobile apps send their Supabase access token in the `Authorization` header. If present, use this path instead of cookies.

```typescript
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { global: { headers: { Authorization: authHeader } } }
    );
```
**Create a one-off Supabase client** configured with the Bearer token from the request. This client is different from the cookie-based server client — it doesn't read cookies. Instead, it sends the Authorization header to Supabase's auth endpoint for validation.

**`process.env.NEXT_PUBLIC_SUPABASE_URL!`** — The Supabase project URL. The `!` asserts it's defined (it should be set in `.env.local`).

**`process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!`** — The public anon key. Safe to use because the Bearer token provides the actual authentication — the anon key just identifies the project.

**`{ global: { headers: { Authorization: authHeader } } }`** — Tells the Supabase client to include this Authorization header on all requests it makes to the Supabase API.

```typescript
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return null;
    return toAuthUser(user);
  }
```
**Validate the token** against Supabase's auth server and convert the result. Same logic as the cookie path.

```typescript
  // Fall back to cookie auth (web)
  return getServerUser();
}
```
**No Bearer token → try cookies.** This is the normal web path. `getServerUser()` creates a cookie-based Supabase client and validates the session.

---

## File 4: `src/server/require-auth-context.ts`

The main function that route handlers call. Orchestrates auth resolution and user lookup.

### Lines 1–4: Imports

```typescript
import { getServerUserFromRequest } from "@/src/auth/server";
```
The function from File 3 that extracts the Supabase user from cookies or Bearer token.

```typescript
import { getOrCreateUser } from "@/src/lib/auth";
```
The database lookup that maps from the Supabase auth ID to the internal user record. Covered in File 5 below.

```typescript
import type { AuthContext } from "./auth-context";
```
The return type (File 1 above).

```typescript
import { UnauthorizedError, ForbiddenError } from "./errors";
```
Error classes that `handleAppError` maps to HTTP 401 and 403 responses.

### Lines 6–13: JSDoc comment

```typescript
/**
 * Extract and validate AuthContext from a request.
 * Handles both cookie (web) and Bearer token (mobile) auth.
 *
 * This runs OUTSIDE the UoW — it uses direct db access internally
 * for getOrCreateUser, which is the only code path that runs without
 * tenant context (documented exception per migration plan D3).
 */
```
The key note: this function runs **before** the UoW transaction opens. The database lookup in `getOrCreateUser` uses a direct `db` connection, not a transaction — because we don't know who the tenant is yet (that's what we're trying to figure out). This is design decision D3.

### Lines 14–18: Function signature and auth check

```typescript
export async function requireAuthContext(req: Request): Promise<AuthContext> {
  const authUser = await getServerUserFromRequest(req);
  if (!authUser) {
    throw new UnauthorizedError();
  }
```
**Call the auth layer** (File 3). If it returns `null` (no valid session, expired token, no cookies), throw `UnauthorizedError`. This becomes a 401 response via `handleAppError` in the route handler's catch block.

After this line, `authUser` contains `{ userId: "<supabase-uuid>", email, name? }`.

### Lines 20–24: Database user lookup

```typescript
  const dbUser = await getOrCreateUser(
    authUser.userId,
    authUser.email,
    authUser.name
  );
```
**Map auth identity → internal user.** This is the critical step where the Supabase auth UUID gets mapped to the internal `users.id`. See File 5 below for full details. After this line, `dbUser` is a full database row from the `users` table, including `id`, `status`, `email`, `name`, `statusReason`, etc.

### Lines 26–35: Account status checks

```typescript
  if (dbUser.status === "suspended") {
    throw new ForbiddenError(
      "Account suspended",
      "ACCOUNT_SUSPENDED",
      dbUser.statusReason
    );
  }
  if (dbUser.status === "soft_deleted") {
    throw new ForbiddenError("Account deleted", "ACCOUNT_DELETED");
  }
```
**Check if the account is still active.** Even though the user has a valid Supabase session, their account may have been suspended or deleted by an admin.

**Suspended:** Throws `ForbiddenError` with code `"ACCOUNT_SUSPENDED"` and includes the `statusReason` (e.g., "Violated terms of service") as the `details` field. This becomes a 403 response. On the client side, `apiFetch` detects this code and dispatches an `"account-status-error"` event, which triggers the `AccountStatusHandler` component to show a full-screen overlay forcing sign-out.

**Soft deleted:** Same pattern but with code `"ACCOUNT_DELETED"` and no reason. Soft-deleted accounts still exist in the database (for data retention) but can't access the app.

### Lines 37–39: Data integrity check

```typescript
  if (!dbUser.email) {
    throw new Error("User record has no email — data integrity issue");
  }
```
**Safety check.** The `email` column shouldn't be null for any valid user. If it is, something went wrong during user creation. This throws a plain `Error` (not an `AppError`), which `handleAppError` maps to a generic 500. This should never happen in normal operation.

### Lines 41–46: Build and return AuthContext

```typescript
  return {
    principalId: dbUser.id,
    supabaseId: authUser.userId,
    email: dbUser.email,
    roles: [],
  };
```
**Assemble the AuthContext** that handlers use.

**`principalId: dbUser.id`** — The internal database UUID. This is the **important one**. From this point forward, all code uses `ctx.principalId` for data access. The UoW sets it as `request.jwt.claims.sub` so `auth.uid()` returns it. Services use it in `WHERE user_id = userId` clauses. New rows get it as their `userId` foreign key.

**`supabaseId: authUser.userId`** — The Supabase auth UUID, included for reference but not used downstream.

**`email: dbUser.email`** — From the database, not the auth token. The database is the source of truth (the user may have changed their email).

**`roles: []`** — Empty for now. When role-based access is added, this would be populated from a roles table or from Supabase custom claims.

---

## File 5: `src/lib/auth.ts`

Maps a Supabase auth identity to an internal user record. Creates the record if it doesn't exist.

### Lines 1–7: Imports and cache

```typescript
import { eq } from "drizzle-orm";
import { users } from "@/src/db/schema";
import type { User } from "@/src/db/schema";
import { db } from "@/src/db";
```
Drizzle ORM imports for querying the `users` table. Note: `db` is the **direct database connection**, not a transaction. This is the documented exception D3.

```typescript
const userCache = new Map<string, User>();
```
**In-memory cache** keyed by Supabase ID. In serverless (Vercel), each function invocation gets a fresh process, so this cache only lasts for the duration of a single request. But within that request, if `getOrCreateUser` is called twice with the same ID (unlikely but possible), the second call returns the cached result without hitting the database.

In a long-lived server, this cache would persist across requests — which is fine because user records rarely change during a session.

### Lines 16–23: Function signature and cache check

```typescript
export async function getOrCreateUser(
  supabaseId: string,
  email: string,
  name?: string
): Promise<User> {
  const cached = userCache.get(supabaseId);
  if (cached) return cached;
```
Check the cache first. If the user was already looked up in this request/process, return immediately.

### Lines 24–33: Lookup by Supabase ID

```typescript
  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.supabaseId, supabaseId))
    .limit(1);

  if (existing) {
    userCache.set(supabaseId, existing);
    return existing;
  }
```
**Primary lookup:** Find the user by their Supabase auth ID. This is the normal path — the user has signed in before, their `supabase_id` column is set.

**`const [existing]`** — Destructures the first element of the result array. Drizzle returns an array of rows; `.limit(1)` ensures at most one. If no row matches, `existing` is `undefined`.

**`userCache.set(...)`** — Cache the result for any subsequent calls in the same request.

### Lines 35–51: Migration fallback — lookup by email

```typescript
  // Migration case: user exists by email but with old auth provider ID.
  // Update their supabaseId to the new value.
  const [byEmail] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (byEmail) {
    const [updated] = await db
      .update(users)
      .set({ supabaseId })
      .where(eq(users.id, byEmail.id))
      .returning();
    userCache.set(supabaseId, updated);
    return updated;
  }
```
**Migration path.** This handles users who were created under the old auth provider (AWS Cognito) and haven't logged in since the switch to Supabase.

Their user record exists (with `email` set) but their `supabase_id` column either has the old Cognito ID or is null. This code finds them by email and updates their `supabase_id` to the new Supabase value.

**`db.update(users).set({ supabaseId })`** — Updates only the `supabase_id` column. The `.returning()` returns the updated row so we can cache and return it.

After migration is complete and all users have logged in at least once, this code path will never be hit. It could be removed in the future.

### Lines 53–64: Create new user

```typescript
  const [newUser] = await db
    .insert(users)
    .values({
      supabaseId,
      email,
      name: name || null,
    })
    .returning();

  userCache.set(supabaseId, newUser);
  return newUser;
}
```
**First-time user.** No existing user record was found by Supabase ID or email, so create one.

**`supabaseId`** — The Supabase auth UUID, stored for future lookups.

**`email`** — From the auth token.

**`name: name || null`** — The display name from Supabase user metadata. Falls back to `null` if not provided.

The database generates the `id` (internal UUID) via `gen_random_uuid()` as the column default. This auto-generated `id` becomes the `principalId` returned in the AuthContext.

**`.returning()`** — Returns the full inserted row, including the generated `id`, `createdAt`, `updatedAt`, and `status` (defaults to `"active"`).

---

## The Complete Flow

```
requireAuthContext(req)                    ← src/server/require-auth-context.ts
  │
  ├── getServerUserFromRequest(req)        ← src/auth/server.ts
  │     │
  │     ├── Has Bearer header?
  │     │   YES → Create Supabase client with token
  │     │         → supabase.auth.getUser() validates against Supabase
  │     │         → Return { userId: supabase-uuid, email, name }
  │     │
  │     │   NO → getServerUser()
  │     │         → Create Supabase client from cookies
  │     │         → supabase.auth.getUser() validates against Supabase
  │     │         → Return { userId: supabase-uuid, email, name }
  │     │
  │     └── Returns null if no valid session → UnauthorizedError (401)
  │
  ├── getOrCreateUser(supabaseId, email, name)  ← src/lib/auth.ts
  │     │
  │     ├── Check in-memory cache → return if found
  │     ├── SELECT ... WHERE supabase_id = ? → return if found
  │     ├── SELECT ... WHERE email = ?
  │     │   → UPDATE supabase_id if found (migration path)
  │     └── INSERT new user if not found → return with generated id
  │
  │     Returns: full users table row (id, supabaseId, email, status, ...)
  │
  ├── Check status: suspended → ForbiddenError (403, ACCOUNT_SUSPENDED)
  ├── Check status: soft_deleted → ForbiddenError (403, ACCOUNT_DELETED)
  ├── Check email not null → Error (500, data integrity)
  │
  └── Return AuthContext:
      {
        principalId: users.id,        ← internal UUID (used everywhere)
        supabaseId:  supabase UUID,   ← auth provider ID (not used after)
        email:       from DB,
        roles:       []
      }
```

### Key Design Points

1. **Auth validation is online** — `supabase.auth.getUser()` calls the Supabase server. It doesn't just decode the JWT locally. This means revoked sessions are caught immediately, but it adds a network round trip.

2. **Two-ID mapping happens here** — The Supabase auth UUID (`authUser.userId`) is translated to the internal database UUID (`dbUser.id`). Everything downstream uses only `principalId`.

3. **Runs before UoW** — The database queries in `getOrCreateUser` use the direct `db` connection, not a transaction. There's no tenant context to set yet because that's what we're looking up. This is exception D3.

4. **Account status is checked at the gate** — Suspended/deleted users are blocked before they reach any handler. The 403 codes (`ACCOUNT_SUSPENDED`, `ACCOUNT_DELETED`) are detected by `apiFetch` on the client, which triggers the force-sign-out overlay.

5. **Migration-safe** — The email fallback path in `getOrCreateUser` handles users migrating from Cognito to Supabase without requiring a batch migration script to run first.
