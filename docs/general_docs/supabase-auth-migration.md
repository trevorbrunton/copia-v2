# Supabase Auth Migration Plan

**Status:** COMPLETE (implemented 2026-03-08, cleanup finalised 2026-03-11)
**Original state:** AWS Cognito (email/password) via Amplify v6, custom session/device tracking, JWKS verification
**Implemented state:** Supabase Auth with native RLS enforcement, Realtime compatibility, simplified auth code

> All 5 phases complete. Cognito env vars removed from `.env.example`, CDK Cognito construct removed from `cdk/lib/mayfly-stack.ts`. Migration script retained at `scripts/migrate-users-to-supabase.ts` for reference.

---

## Why Migrate

1. **RLS enforcement** — Supabase Auth provides `auth.uid()` that RLS policies can reference natively. Currently RLS policies exist but are bypassed by the `postgres` connection role. Migration makes tenant isolation database-enforced, not just application-enforced.
2. **Realtime compatibility** — Client-side Supabase Realtime requires Supabase Auth. Without it, you need a server-side proxy layer (Phase 4 of Cronicle plan). With it, clients subscribe directly.
3. **Less code to maintain** — Replaces ~13 auth module files, JWKS caching, Amplify Hub listeners, and cookie sync logic with Supabase's SDK.
4. **Simpler infrastructure** — Drop Cognito from CDK. Auth lives where the database lives.

---

## What Changes vs What Stays

### Changes
| Component | Before (Cognito) | After (Supabase Auth) |
|---|---|---|
| Auth SDK | `aws-amplify` | `@supabase/supabase-js` + `@supabase/ssr` |
| JWT issuer | Cognito User Pool | Supabase project |
| JWT verification | Custom JWKS fetch + jose | `supabase.auth.getUser()` or `supabase.auth.getSession()` |
| Sign-in/up | Amplify `signIn`/`signUp` | `supabase.auth.signInWithPassword`/`signUp` |
| Password reset | Amplify `resetPassword` + `confirmResetPassword` | `supabase.auth.resetPasswordForEmail` + `updateUser` |
| Password change | Amplify `updatePassword` (Cognito-managed) | `supabase.auth.updateUser({ password })` |
| MFA | Amplify TOTP (`setUpTOTP`, `verifyTOTPSetup`) | Supabase MFA API (`enroll`, `challenge`, `verify`) |
| Session cookie | Manual sync via `/api/auth/session` POST | `@supabase/ssr` handles cookies automatically |
| Middleware | Custom `createAuthProxy` with JWKS verification | Supabase middleware helper (refresh session, check auth) |
| User ID in DB | `cognito_id` column (Cognito `sub`) | `supabase_id` column (Supabase `auth.uid()`) |
| RLS policies | `current_tenant_id()` function (bypassed) | `auth.uid()` (enforced natively) |
| CDK | Cognito User Pool + App Client | Remove entirely |
| Env vars | `NEXT_PUBLIC_COGNITO_*` (3 vars) | `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` |

### Stays the Same
| Component | Why |
|---|---|
| Session/device tracking tables | Custom feature — Supabase Auth doesn't track devices the same way |
| `useAuth()` hook interface | Same API shape, different implementation behind it |
| Auth pages (sign-in, sign-up, etc.) | Same forms, just call different SDK methods |
| `requireAuthContext()` | Same pattern, different token verification |
| `AuthContext` type | Same shape (rename `cognitoId` to `supabaseId`) |
| Handler/UoW/service architecture | Auth-provider agnostic — no changes needed |
| Heartbeat + session TTL | Keep custom session management |
| Account status checks | Keep suspended/deleted enforcement |
| Validation schemas | Zod schemas are auth-provider agnostic |

---

## Design Decisions

### DA1: User Migration Strategy

**Decision:** Batch export from Cognito, import to Supabase Auth with password reset.

**Rationale:** Cognito doesn't export password hashes in a format Supabase can import. Options:
1. **Password reset on first login** — Import users with email only, force password reset. Simple, but disrupts all users.
2. **Dual-auth transition period** — Support both Cognito and Supabase Auth temporarily. Complex, error-prone.
3. **Fresh start** — If user count is small enough, have users re-register. Simplest if acceptable.

**For Mayfly (likely small user base):** Option 1 or 3. If < 50 users, option 3 with an email notification is fine. If more, option 1 with a "reset your password" flow on first visit.

### DA2: Session Cookie Strategy

**Decision:** Use `@supabase/ssr` for automatic cookie management, replacing the manual `/api/auth/session` endpoint.

**Rationale:** `@supabase/ssr` handles:
- Setting auth cookies on sign-in
- Refreshing tokens automatically
- Clearing cookies on sign-out
- Server-side session access via `createServerClient`

This eliminates `src/lib/cookies.ts`, the `/api/auth/session` route, and the manual cookie sync in `AuthProvider`.

### DA3: RLS Migration Strategy

**Decision:** Replace `current_tenant_id()` function with `auth.uid()` in all RLS policies.

**Rationale:** With Supabase Auth, every database query carries the authenticated user's ID via `auth.uid()`. No need for `SET LOCAL app.current_tenant_id` — the database knows who the user is from the JWT automatically.

**Implication for UoW:** `DrizzleUoW` and `DrizzleReadOnly` no longer need to set `app.current_tenant_id`. They still provide transaction boundaries and read-only enforcement, but identity injection is handled by Supabase's PostgREST/connection layer.

However, if using `postgres-js` directly (not PostgREST), you still need to set the JWT claim for RLS. Supabase provides `SET LOCAL request.jwt.claims` for this. See Phase 3 for details.

### DA4: Custom Session/Device Tracking

**Decision:** Keep `userSessions`, `userDevices`, and login history tables.

**Rationale:** Supabase Auth tracks sessions internally but doesn't expose device fingerprinting, session listing with device info, or login history the way Mayfly's custom system does. These are user-facing features (security tab) worth keeping.

### DA5: MFA Approach

**Decision:** Defer MFA migration. Remove MFA code in Phase 2 (it exists but isn't enforced). Re-add using Supabase MFA API when needed.

**Rationale:** MFA in Mayfly is currently optional and not widely used. Supabase has its own MFA API (TOTP-based) that works differently from Cognito's. Porting the MFA code adds complexity to the migration for a feature that can be re-added later with less effort than converting it.

### DA6: Database Connection Strategy

**Decision:** Use Supabase client library for auth operations, keep `postgres-js` (Drizzle) for data operations.

**Rationale:** Two connection paths:
1. **Supabase client** (`@supabase/supabase-js`) — For auth operations. Uses the `anon` key + user JWT. RLS enforced automatically.
2. **Drizzle** (`postgres-js`) — For service layer data access via UoW. Needs to set JWT claims manually for RLS (see DA3).

This avoids rewriting all services to use the Supabase client query builder. The service layer continues using Drizzle with the existing `(tx, userId, ...)` pattern. RLS is enforced at the database level regardless of which client connects.

---

## Phase 0: Supabase Auth Setup (No Code Changes)

**Goal:** Configure Supabase Auth in the dashboard. Verify it works independently.

### 0.1 Enable Supabase Auth

In the Supabase dashboard:
1. Go to Authentication > Providers
2. Enable Email provider (email/password sign-in)
3. Configure email templates (confirmation, password reset, magic link)
4. Set JWT expiry to 1 hour (match current Cognito setting)
5. Set refresh token rotation to enabled

### 0.2 Configure auth settings

- Site URL: `http://localhost:3000` (dev), production URL for prod
- Redirect URLs: Add all valid callback URLs
- Disable email confirmations for dev (optional — speeds up testing)
- Password policy: minimum 8 characters (match current Cognito policy)

### 0.3 Get credentials

Add to `.env.local`:
```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...  # Server-side only, never expose to client
```

### 0.4 Create a test user manually

In Supabase dashboard > Authentication > Users, create a test user. Verify you can see them in the `auth.users` table.

### 0.5 Verify `auth.uid()` works with direct postgres-js connections

**This is a critical gate.** The entire RLS strategy depends on whether `auth.uid()` works when connecting via `postgres-js` (Drizzle) rather than PostgREST.

Test script:
```typescript
// scripts/test-auth-uid.ts
import { db } from "@/src/db";
import { sql } from "drizzle-orm";

const testUserId = "paste-supabase-user-id-from-step-0.4";

// Attempt 1: SET LOCAL request.jwt.claims
await db.transaction(async (tx) => {
  await tx.execute(
    sql.raw(`SET LOCAL request.jwt.claims = '${JSON.stringify({ sub: testUserId })}'`)
  );
  const [result] = await tx.execute(sql.raw(`SELECT auth.uid() as uid`));
  console.log("auth.uid() result:", result);
  console.log("Match:", result?.uid === testUserId);
});
```

**If `auth.uid()` returns the correct user ID:** Proceed with the plan as written.

**If `auth.uid()` returns NULL or errors:** Switch to the CronIQ pattern:
1. Create a `mayfly_app` database role WITHOUT BYPASSRLS
2. Keep the `current_tenant_id()` function approach
3. Connect Drizzle using the `mayfly_app` role instead of `postgres`
4. Update Phase 3.6 RLS policies to use `current_tenant_id()` (not `auth.uid()`)
5. Document the decision in DA3

**Do not proceed to Phase 2 until this is resolved.** The outcome determines the RLS strategy for the entire migration.

**Files changed:** 1 (`.env.local`) + 1 test script
**Risk:** None — no code changes
**Testing:** Run `scripts/test-auth-uid.ts` and document result before proceeding.

---

## Phase 1: Install Dependencies + Supabase Client Setup

**Goal:** Add Supabase SDK, create client helpers. No auth changes yet — both systems coexist.

### 1.1 Install packages

```bash
bun add @supabase/supabase-js @supabase/ssr
```

### 1.2 Create Supabase client helpers

```typescript
// src/lib/supabase/client.ts — Browser client
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
```

```typescript
// src/lib/supabase/server.ts — Server client (API routes, server components)
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createServerSupabase() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        },
      },
    }
  );
}
```

```typescript
// src/lib/supabase/middleware.ts — Middleware client
import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";

export async function createMiddlewareSupabase(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );
  return { supabase, response };
}
```

```typescript
// src/lib/supabase/admin.ts — Service role client (bypasses RLS)
import { createClient } from "@supabase/supabase-js";

export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);
```

**Files created:** 4
**Files changed:** 1 (package.json)
**Risk:** None — no existing code modified
**Testing:** Unit test each Supabase client helper — verify they create clients without errors and return the expected shape. Verify `createServerSupabase()` can read cookies. Run `npx tsc --noEmit` to confirm no type errors.

---

## Phase 2: Auth Provider Migration

**Goal:** Replace Cognito auth with Supabase Auth in the client-side provider. This is the largest phase.

### 2.1 Rewrite AuthProvider

Replace `src/auth/provider.tsx` internals. Keep the same `AuthContextValue` interface so all consumers (`useAuth()`) continue working without changes.

**Key mapping:**

| Cognito (current) | Supabase Auth (new) |
|---|---|
| `amplifySignIn({ username, password })` | `supabase.auth.signInWithPassword({ email, password })` |
| `amplifySignUp({ username, password, options })` | `supabase.auth.signUp({ email, password, options: { data: { name } } })` |
| `amplifyConfirmSignUp({ username, confirmationCode })` | Not needed — Supabase handles email confirmation via redirect |
| `amplifyResendSignUpCode({ username })` | `supabase.auth.resend({ type: 'signup', email })` |
| `amplifySignOut()` | `supabase.auth.signOut()` |
| `amplifyResetPassword({ username })` | `supabase.auth.resetPasswordForEmail(email)` |
| `amplifyConfirmResetPassword({ username, confirmationCode, newPassword })` | `supabase.auth.updateUser({ password })` (after redirect callback) |
| `amplifyUpdatePassword({ oldPassword, newPassword })` | `supabase.auth.updateUser({ password: newPassword })` |
| `amplifyGetCurrentUser()` | `supabase.auth.getUser()` |
| Hub listener (`signedIn`, `tokenRefresh`, etc.) | `supabase.auth.onAuthStateChange(callback)` |

**Key differences:**
- No `confirmSignUp` step — Supabase sends a confirmation email with a link, not a code. The user clicks the link and is redirected back. This changes the verify page flow.
- Password reset works via email link + redirect, not code entry. The reset-password page receives a token in the URL.
- No manual cookie sync needed — `@supabase/ssr` handles it.
- No localStorage cleanup needed — Supabase manages its own storage.

### 2.2 Update verify flow

Supabase uses email links, not verification codes. Two options:

**Option A (recommended):** Remove the `/verify` page entirely. Supabase sends a confirmation email with a magic link. User clicks it, gets redirected to your app, and is automatically signed in.

Add a callback route:
```typescript
// app/auth/callback/route.ts
import { createServerSupabase } from "@/src/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");

  if (code) {
    const supabase = await createServerSupabase();
    await supabase.auth.exchangeCodeForSession(code);
  }

  return NextResponse.redirect(new URL("/dashboard", request.url));
}
```

**Option B:** Use Supabase's OTP mode (6-digit code via email). This preserves the current UX but requires enabling OTP in Supabase dashboard.

### 2.3 Update password reset flow

Current flow: `/forgot-password` (enter email) → `/reset-password` (enter code + new password).

Supabase flow: `/forgot-password` (enter email) → Supabase sends reset link → user clicks link → redirected to `/reset-password` with token → enter new password.

Update `/reset-password` page to:
1. Extract token from URL (Supabase adds it as a hash fragment or query param)
2. Call `supabase.auth.updateUser({ password: newPassword })`

### 2.4 Update security tab (password change)

Replace `useAuth().updatePassword(oldPassword, newPassword)` implementation:

```typescript
// Old: Cognito requires old password
await amplifyUpdatePassword({ oldPassword, newPassword });

// New: Supabase doesn't require old password (user is already authenticated)
await supabase.auth.updateUser({ password: newPassword });
```

Consider keeping old password verification as UX confirmation (call `signInWithPassword` first to verify).

### 2.5 Remove MFA code (defer re-implementation)

Remove from AuthProvider:
- `setupMfa()` / `verifyMfa()` / `disableMfa()`
- TOTP-related imports and state

Remove from security tab:
- MFA setup section

Add back later using Supabase MFA API when needed.

### 2.6 Update session creation

Current flow: AuthProvider calls `/api/auth/session` POST to sync JWT to cookie.
New flow: `@supabase/ssr` sets cookies automatically. Remove the manual sync.

Keep the custom session/device creation call — after successful sign-in, still call `/api/user/sessions` POST to create a database session record for device tracking.

### 2.7 Remove Cognito-specific code

Delete:
- `src/auth/config.ts` (Amplify config)
- `src/auth/jwks-cache.ts` (JWKS caching)
- `src/auth/errors.ts` (Cognito error mapping — replace with Supabase error mapping)
- `src/auth/constants.ts` (Cognito region)

Keep:
- `src/auth/context.ts` (useAuth hook — same interface)
- `src/auth/validation.ts` (form schemas — auth-agnostic)
- `src/auth/types.ts` (update AuthUser type)
- `src/auth/index.ts` (update exports)

**Files created:** ~3 (callback route, Supabase error mapping)
**Files changed:** ~8 (provider, auth pages, security tab, types, index)
**Files deleted:** ~4 (config, jwks-cache, errors, constants)
**Risk:** Medium — core auth flow changes. Test thoroughly.
**Testing:**
- Integration test: sign-up → email confirmation → sign-in → sign-out flow
- Integration test: password reset flow (request reset → click link → set new password)
- Integration test: password change from security tab (verify old password UX works)
- Unit test: `onAuthStateChange` listener correctly updates auth state
- Unit test: error mapping returns user-friendly messages for all Supabase auth errors
- Verify: `useAuth()` hook interface unchanged — all existing consumers work without modification
- Run `npx tsc --noEmit` after all changes

---

## Phase 3: Server-Side Auth Migration

**Goal:** Replace Cognito JWT verification with Supabase Auth on the server. Update middleware, requireAuthContext, and RLS.

### 3.1 Rewrite middleware (proxy.ts)

Replace `createAuthProxy()` with Supabase middleware:

```typescript
// proxy.ts
import { createMiddlewareSupabase } from "@/src/lib/supabase/middleware";
import { NextRequest, NextResponse } from "next/server";

const PUBLIC_ROUTES = ["/", "/sign-in", "/sign-up", "/forgot-password", "/reset-password"];
const AUTH_PAGES = ["/", "/sign-in", "/sign-up", "/forgot-password", "/reset-password"];

export default async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip API routes, static files
  if (pathname.startsWith("/api/") || pathname.startsWith("/_next/") || pathname.includes(".")) {
    return NextResponse.next();
  }

  const { supabase, response } = await createMiddlewareSupabase(request);
  const { data: { user } } = await supabase.auth.getUser();

  const isPublic = PUBLIC_ROUTES.some(r => pathname === r || pathname.startsWith(r + "/"));
  const isAuthPage = AUTH_PAGES.some(r => pathname === r || pathname.startsWith(r + "/"));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    if (pathname !== "/") url.searchParams.set("redirect", pathname);
    return NextResponse.redirect(url);
  }

  if (user && isAuthPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
```

### 3.2 Rewrite requireAuthContext

```typescript
// src/server/require-auth-context.ts
import { createServerSupabase } from "@/src/lib/supabase/server";
import { getOrCreateUser } from "@/src/lib/auth";
import type { AuthContext } from "./auth-context";
import { UnauthorizedError, ForbiddenError } from "./errors";

export async function requireAuthContext(req: Request): Promise<AuthContext> {
  const supabase = await createServerSupabase();
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) throw new UnauthorizedError();

  const dbUser = await getOrCreateUser(user.id, user.email!, user.user_metadata?.name);

  if (dbUser.status === "suspended")
    throw new ForbiddenError("Account suspended", "ACCOUNT_SUSPENDED", dbUser.statusReason);
  if (dbUser.status === "soft_deleted")
    throw new ForbiddenError("Account deleted", "ACCOUNT_DELETED");

  if (!dbUser.email) {
    throw new Error("User record has no email — data integrity issue");
  }

  return {
    principalId: dbUser.id,
    supabaseId: user.id,
    email: dbUser.email,
    roles: [],
  };
}
```

### 3.3 Update AuthContext type

```typescript
// src/server/auth-context.ts
export type AuthContext = {
  principalId: string;   // DB user.id (UUID)
  supabaseId: string;    // Supabase auth.uid()
  email: string;
  roles: string[];
};
```

### 3.4 Update getOrCreateUser

`getOrCreateUser` currently uses `withBootstrapContext` from `src/lib/tenant.ts`. This is the bootstrap path — it runs BEFORE a tenant exists (it creates the user record). With RLS enforced, this function cannot use the user's connection because:
- On first login, there's no `users` row yet, so `auth.uid()` matches nothing
- The `INSERT INTO users` would be blocked by the RLS SELECT policy

**Solution:** Use the `supabaseAdmin` (service role) client for bootstrap operations. The service role bypasses RLS by design.

```typescript
// src/lib/auth.ts
import { eq } from "drizzle-orm";
import { users } from "@/src/db/schema";
import type { User } from "@/src/db/schema";
import { getSupabaseAdmin } from "@/src/lib/supabase/admin";
import { db } from "@/src/db";

// In-memory cache for user lookups (per-request in serverless)
const userCache = new Map<string, User>();

export async function getOrCreateUser(
  supabaseId: string,
  email: string,
  name?: string
): Promise<User> {
  const cached = userCache.get(supabaseId);
  if (cached) return cached;

  // Bootstrap runs outside UoW with direct db access (no RLS).
  // This is the ONLY code path that bypasses tenant isolation — documented exception (D3).
  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.supabaseId, supabaseId))
    .limit(1);

  if (existing) {
    userCache.set(supabaseId, existing);
    return existing;
  }

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

**Note:** If the direct `postgres-js` connection has a non-BYPASSRLS role (CronIQ pattern from Phase 0.5 fallback), bootstrap must use a separate service-role connection. Create a `dbAdmin` Drizzle instance using the superuser/service connection for this one function.

Also clean up:
- Remove `withBootstrapContext` import from `auth.ts`
- `withBootstrapContext` in `tenant.ts` can be deleted (see Phase 5)

### 3.5 Database migration — rename cognito_id column

```sql
-- 008_rename_cognito_to_supabase.sql
ALTER TABLE users RENAME COLUMN cognito_id TO supabase_id;

-- Verify: the primary key (users.id UUID) is unchanged.
-- All foreign keys (user_sessions.user_id, user_devices.user_id, projects.user_id,
-- chat_conversations.user_id, chat_messages.conversation_id, user_status_history.user_id)
-- reference users.id (UUID), NOT cognito_id. They are unaffected by this rename.
-- Only the unique index on cognito_id needs renaming:
ALTER INDEX IF EXISTS idx_users_cognito_id RENAME TO idx_users_supabase_id;
```

Update `src/db/schema.ts`:
- Rename `cognitoId: text("cognito_id")` → `supabaseId: text("supabase_id")`
- Update the `User` type export accordingly

**Verification:** After running the migration, confirm:
1. `SELECT column_name FROM information_schema.columns WHERE table_name = 'users'` shows `supabase_id` (not `cognito_id`)
2. `getOrCreateUser` still returns a `User` with `id` (UUID primary key) — all downstream FK references use this `id`, not the renamed column
3. All integration tests pass with the updated schema

### 3.6 Update RLS policies to use auth.uid()

```sql
-- 009_rls_supabase_auth.sql

-- Drop existing policies that use current_tenant_id()
DROP POLICY IF EXISTS users_tenant_isolation ON users;
DROP POLICY IF EXISTS projects_tenant_isolation ON projects;
-- ... (all tables)

-- Create new policies using auth.uid()
CREATE POLICY users_tenant_isolation ON users
  FOR ALL USING (id = auth.uid());

CREATE POLICY projects_tenant_isolation ON projects
  FOR ALL USING (user_id = auth.uid());

CREATE POLICY chat_conversations_tenant_isolation ON chat_conversations
  FOR ALL USING (user_id = auth.uid());

-- ... (all tables with user_id column)

-- Drop the current_tenant_id() function (no longer needed)
DROP FUNCTION IF EXISTS current_tenant_id();
```

**Important:** `auth.uid()` only works when the query is made through the Supabase client with a valid JWT, or when `request.jwt.claims` is set on a direct connection. Since Mayfly uses `postgres-js` (Drizzle) directly, you need to set the JWT claims in the UoW:

```typescript
// src/server/uow/drizzle-uow.ts (updated)
export class DrizzleUoW implements UnitOfWork {
  async run<T>(ctx: AuthContext, fn: (tx: TransactionContext) => Promise<T>): Promise<T> {
    return db.transaction(async (tx) => {
      // Set the JWT sub claim so auth.uid() works with direct connections
      await tx.execute(
        sql.raw(`SET LOCAL request.jwt.claims = '${JSON.stringify({ sub: ctx.supabaseId }).replace(/'/g, "''")}'`)
      );
      await tx.execute(sql.raw(`SET LOCAL statement_timeout = '30000'`));
      return fn({ db: tx });
    });
  }
}
```

**Alternative:** If `auth.uid()` doesn't work with `SET LOCAL request.jwt.claims` on direct postgres connections (it may only work via PostgREST), keep the `current_tenant_id()` approach but connect with a non-superuser role. Test this during Phase 0.

### 3.7 Update UoW — remove or update identity injection

Depending on the RLS approach chosen in 3.6:
- **If `auth.uid()` works:** Set `request.jwt.claims` (see above)
- **If sticking with `current_tenant_id()`:** Keep current approach but create a `mayfly_app` role without BYPASSRLS (like CronIQ's `croniq_app` role)
- Either way, `DrizzleReadOnly` keeps `SET TRANSACTION READ ONLY`

### 3.8 Remove Cognito server code

Delete:
- `src/auth/server.ts` (JWT verification — replaced by `supabase.auth.getUser()`)
- `src/auth/proxy.ts` (middleware — replaced by new `proxy.ts`)
- `src/lib/cookies.ts` (manual cookie management — handled by `@supabase/ssr`)

Delete:
- `app/api/auth/session/route.ts` — This route currently does two things: (1) sync JWT to cookie and (2) call `getOrCreateUser`. With Supabase Auth, (1) is handled by `@supabase/ssr` automatically, and (2) is already handled by `requireAuthContext` (which calls `getOrCreateUser` on every authenticated request). The custom session/device creation (POST to `/api/user/sessions`) is a separate route and is unaffected.

**Files created:** ~2 (migration SQL files)
**Files changed:** ~6 (requireAuthContext, auth-context, getOrCreateUser, schema, UoW, proxy.ts)
**Files deleted:** ~3 (server.ts, proxy.ts, cookies.ts)
**Risk:** High — RLS policy changes + auth verification changes. Run full test suite.
**Testing:**
- Integration test: `requireAuthContext` returns correct `AuthContext` with Supabase tokens
- Integration test: `requireAuthContext` rejects expired/invalid tokens with `UnauthorizedError`
- Integration test: RLS enforcement — user A cannot read user B's projects/conversations
- Integration test: `getOrCreateUser` creates new user on first login (bootstrap path)
- Integration test: `getOrCreateUser` returns existing user on subsequent logins
- Integration test: middleware redirects unauthenticated users to `/sign-in`
- Integration test: middleware redirects authenticated users on public routes to `/dashboard`
- Run full existing test suite: `bun run test`
- Run `npx tsc --noEmit`

---

## Phase 4: User Migration

**Goal:** Migrate existing Cognito users to Supabase Auth.

### 4.1 Pre-migration validation

Before exporting, verify data integrity:
```sql
-- Check for duplicate emails (shouldn't exist, but Cognito allows it in some configurations)
SELECT email, count(*) FROM users GROUP BY email HAVING count(*) > 1;

-- Check for users without cognito_id (data integrity)
SELECT id, email FROM users WHERE supabase_id IS NULL OR supabase_id = '';
```

If duplicates exist, resolve them manually before proceeding.

### 4.2 Export users from Cognito

```bash
aws cognito-idp list-users \
  --user-pool-id ap-southeast-2_XXXXX \
  --attributes-to-get email name \
  > cognito-users.json
```

### 4.3 Import users to Supabase Auth

Use the Supabase Admin API to create users:

```typescript
// scripts/migrate-users.ts
import { getSupabaseAdmin } from "@/src/lib/supabase/admin";
import cognitoUsers from "./cognito-users.json";

for (const user of cognitoUsers.Users) {
  const email = user.Attributes.find(a => a.Name === "email")?.Value;
  const name = user.Attributes.find(a => a.Name === "name")?.Value;

  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    email_confirm: true, // Skip confirmation — they already verified with Cognito
    user_metadata: { name },
  });

  if (error) {
    console.error(`Failed to create ${email}:`, error.message);
    continue;
  }

  // Update the database record: cognitoId → supabaseId
  await db.update(users)
    .set({ supabaseId: data.user.id })
    .where(eq(users.email, email));
}
```

### 4.4 Notify users

Users will need to reset their passwords (Cognito password hashes can't be imported). Options:
- Send a bulk password reset email via `supabase.auth.admin.generateLink({ type: 'recovery', email })`
- Show a "please reset your password" banner on first visit
- If user count is very small, just tell them directly

### 4.5 Update test helpers

```typescript
// src/test/helpers.ts
// Change: cognitoId → supabaseId in createTestUser
const supabaseId = overrides.supabaseId || `${TEST_PREFIX}supabase_${id}`;
```

**Files created:** 1 (migration script)
**Files changed:** ~2 (test helpers, schema)
**Risk:** Medium — data migration. Run on staging first.
**Testing:**
- Run pre-migration validation queries (4.1) — confirm no duplicate emails or missing IDs
- Run migration script on staging data first — verify all users created in Supabase Auth
- Verify: every `users` row has a valid `supabase_id` after migration
- Verify: at least one migrated user can sign in after password reset
- Run full test suite with updated test helpers: `bun run test`

---

## Phase 5: Cleanup

**Goal:** Remove all Cognito infrastructure and dependencies.

### 5.1 Remove Amplify dependency

```bash
bun remove aws-amplify
```

### 5.2 Remove CDK Cognito construct

Delete or update `cdk/lib/mayfly-stack.ts` — remove User Pool and App Client. If CDK has no other resources, consider whether the CDK stack is still needed.

### 5.3 Remove Cognito env vars

From `.env.local` and `.env.example`:
```
# Remove these:
NEXT_PUBLIC_COGNITO_USER_POOL_ID=...
NEXT_PUBLIC_COGNITO_CLIENT_ID=...
NEXT_PUBLIC_COGNITO_REGION=...
```

### 5.4 Clean up tenant.ts

Delete or simplify `src/lib/tenant.ts`:
- Delete `withBootstrapContext` — replaced by direct `db` access in `getOrCreateUser` (Phase 3.4)
- Delete `withTenantContext` — replaced by UoW's `SET LOCAL` (if `current_tenant_id()` path) or no longer needed (if `auth.uid()` path)
- Delete `current_tenant_id()` SQL function if using `auth.uid()` path (already handled in migration 009)
- Audit all imports of `tenant.ts` across the codebase — remove dead references
- If `tenant.ts` has no remaining exports, delete the file entirely

### 5.5 Remove /verify page

If using Supabase's email link confirmation (DA2 Option A), the verify page is no longer needed. Replace with the callback route.

### 5.6 Update documentation

- `CLAUDE.md` — Update tech stack, auth patterns, env vars
- `docs/AUTH_REFERENCE.md` — Rewrite for Supabase Auth
- Memory files — Update architecture notes

### 5.7 Run full test suite

```bash
bun run test
npx tsc --noEmit
```

**Files deleted:** ~5 (remaining Cognito files, verify page)
**Files changed:** ~5 (package.json, CDK, env files, docs)
**Risk:** Low — just cleanup

---

## Phase Summary

| Phase | What | Files | Risk | Estimate |
|---|---|---|---|---|
| 0 | Supabase Auth setup + `auth.uid()` verification | 2 | None | 2 hours |
| 1 | Install SDK + client helpers | 5 | None | 2 hours |
| 2 | Client-side auth migration | ~15 | Medium | 2 days |
| 3 | Server-side auth + RLS migration | ~11 | High | 2 days |
| 4 | User data migration (with pre-validation) | ~3 | Medium | Half day |
| 5 | Cleanup (including tenant.ts, feature flag removal) | ~12 | Low | Half day |

**Total: ~5-6 days**

---

## Migration Order and Dependencies

```
Phase 0 (Setup)         <- No dependencies. Dashboard config only.
  |
Phase 1 (SDK)           <- Needs Phase 0. No breaking changes.
  |
Phase 2 (Client Auth)   <- Needs Phase 1. Breaking change — deploy with Phase 3.
  |
Phase 3 (Server Auth)   <- Needs Phase 2. Must deploy together with Phase 2.
  |
Phase 4 (User Migration) <- Needs Phase 3. Run before/during deployment.
  |
Phase 5 (Cleanup)       <- Needs Phase 4. Safe to do anytime after.
```

**Critical deployment:** Phases 2 + 3 + 4 should be deployed together. The app can't work with half-Cognito half-Supabase auth.

**Deployment risk mitigation:** Consider adding an env var `NEXT_PUBLIC_AUTH_PROVIDER=cognito|supabase` in Phase 1 to gate auth code paths. This allows:
- Building and testing the Supabase auth path behind the flag during development
- Instant rollback by flipping the env var back to `cognito` if issues arise post-deploy
- Adds ~half a day but dramatically reduces deployment risk for this high-stakes change
- Remove the flag in Phase 5 once migration is confirmed stable

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| `auth.uid()` doesn't work with direct postgres-js connections | RLS policies won't enforce | Test in Phase 0. Fallback: use `current_tenant_id()` with a non-BYPASSRLS role (CronIQ pattern) |
| Password migration disrupts users | Users can't sign in | Send password reset emails before cutover. Show banner explaining the change |
| Supabase email delivery issues | Users don't receive verification/reset emails | Configure custom SMTP (SES) in Supabase dashboard |
| `@supabase/ssr` cookie handling conflicts with existing cookie logic | Auth state inconsistencies | Remove all manual cookie code before enabling Supabase cookies |
| Supabase Auth downtime | All auth fails | Accept this trade-off — same risk exists with Cognito. Supabase has 99.9% SLA on Pro plan |

---

## Post-Migration Benefits

Once complete, these previously complex features become simple:

1. **RLS enforcement** — Database-level tenant isolation, not just application-level
2. **Client-side Realtime** — `supabase.channel('changes').on('postgres_changes', ...)` works out of the box
3. **Social logins** — Enable Google/GitHub/etc in dashboard, add buttons to sign-in page
4. **Org/team support** — Supabase custom claims + RLS policies for multi-tenant access
5. **Simpler auth code** — ~300 lines instead of ~800 lines
