# Authentication System — Developer Reference

> **Updated 2026-03-08**: Migrated from AWS Cognito to Supabase Auth.

## Table of Contents

1. [Theory of Operation](#1-theory-of-operation)
2. [Architecture Overview](#2-architecture-overview)
3. [Security Model](#3-security-model)
4. [End-to-End Functional Flows](#4-end-to-end-functional-flows)
5. [File Inventory](#5-file-inventory)
6. [Calling Patterns & Dependency Graph](#6-calling-patterns--dependency-graph)
7. [Environment Variables](#7-environment-variables)
8. [Token Lifecycle](#8-token-lifecycle)

---

## 1. Theory of Operation

The authentication system uses **Supabase Auth** as the identity provider with **`@supabase/ssr`** for cookie-based session management in Next.js.

### Core Principles

- **Supabase Auth is the source of truth** for identity. All credential operations (sign-in, sign-up, password reset, OTP verification) are handled by the Supabase client SDK.
- **Cookie-based sessions** are managed automatically by `@supabase/ssr`. Supabase handles token storage, refresh, and cookie management — no manual cookie endpoints needed.
- **Middleware validates sessions** by calling `supabase.auth.getUser()`, which validates the JWT server-side. This runs on every navigation to protected routes.
- **Dual auth methods** support both web and mobile clients. Web clients authenticate via Supabase-managed cookies (automatically sent with requests). Mobile/API clients authenticate via `Authorization: Bearer <token>` headers.
- **Automatic user provisioning** links Supabase identities to database users. The first API call from a new Supabase user triggers creation of a corresponding `users` row, linking `supabaseId` to a database `uuid`.
- **Row-Level Security (RLS)** enforces tenant isolation. Every protected API route executes within a Unit of Work (`DrizzleUoW`), which sets a PostgreSQL session variable (`app.current_tenant_id`) used by database RLS policies.

### Request Lifecycle (Authenticated)

```
Browser Request
    │
    ▼
Next.js Middleware (proxy.ts)
    │  Creates Supabase middleware client (cookie propagation)
    │  Calls supabase.auth.getUser() (server-side JWT validation)
    │  Redirects if no user and route is protected
    │
    ▼
API Route Handler
    │
    ▼
requireAuthContext(req)
    │  Extracts user from cookie or Bearer header
    │  Uses supabase.auth.getUser() for validation
    │  Returns AuthContext { userId, email } or throws 401
    │
    ▼
getOrCreateUser()
    │  Looks up user by supabaseId
    │  Creates user row if first visit (runs outside UoW)
    │
    ▼
makeDeps() → { uow, readOnly }
    │  uow.execute(async (tx) => { ... })
    │    Opens database transaction
    │    SET LOCAL statement_timeout
    │    SET LOCAL app.current_tenant_id = <userId>
    │
    ▼
Handler Logic (within tenant-scoped transaction via UoW)
```

---

## 2. Architecture Overview

### Layer Diagram

```
┌─────────────────────────────────────────────────────────┐
│                    BROWSER (Client)                      │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐ │
│  │ AuthProvider  │  │  Auth Pages  │  │  App Pages    │ │
│  │ (context.ts)  │  │  (public)    │  │  (protected)  │ │
│  └──────┬───────┘  └──────┬───────┘  └───────┬───────┘ │
│         │                 │                   │         │
│         ▼                 │                   │         │
│  ┌──────────────┐         │            ┌──────┴──────┐  │
│  │ Supabase     │        │            │  apiFetch() │  │
│  │ Client SDK   │        │            │  (hooks)    │  │
│  └──────┬───────┘         │            └──────┬──────┘  │
│         │                 │                   │         │
└─────────┼─────────────────┼───────────────────┼─────────┘
          │                 │                   │
          ▼                 │                   ▼
┌─────────────────┐         │    ┌──────────────────────┐
│  Supabase Auth   │        │    │  Next.js Server       │
│  (hosted)        │        │    │                      │
│                  │        │    │  ┌────────────────┐  │
└─────────────────┘         │    │  │ Middleware      │  │
                            │    │  │ (proxy.ts)      │  │
                            │    │  │ getUser() call  │  │
                            │    │  └───────┬────────┘  │
                            │    │          ▼           │
                            │    │  ┌────────────────┐  │
                            │    │  │ /auth/callback  │  │
                            │    │  │ (code exchange) │  │
                            │    │  └───────┬────────┘  │
                            │    │          ▼           │
                            │    │  ┌────────────────┐  │
                            │    │  │requireAuthCtx  │  │
                            │    │  │ (getUser())    │  │
                            │    │  └───────┬────────┘  │
                            │    │          ▼           │
                            │    │  ┌────────────────┐  │
                            │    │  │ makeDeps()     │  │
                            │    │  │ → UoW (RLS)    │  │
                            │    │  └───────┬────────┘  │
                            │    │          ▼           │
                            │    │  ┌────────────────┐  │
                            │    │  │ Handler →      │  │
                            │    │  │ Service layer  │  │
                            │    │  └───────┬────────┘  │
                            │    │          ▼           │
                            │    │  ┌────────────────┐  │
                            │    │  │ PostgreSQL     │  │
                            │    │  │ (Supabase)     │  │
                            │    │  └────────────────┘  │
                            │    └──────────────────────┘
```

### Provider Hierarchy

```
<html>
  <body>
    <AuthProvider>           ← Supabase auth state + session management
      <Providers>            ← components/providers.tsx
        <QueryClientProvider> ← TanStack Query
          <ThemeProvider>     ← Dark/light mode
            {children}
            <Toaster />
          </ThemeProvider>
        </QueryClientProvider>
      </Providers>
    </AuthProvider>
  </body>
</html>
```

`AuthProvider` wraps everything, including `QueryClientProvider`. This means TanStack Query hooks can depend on auth state being available. Auth state is resolved before data fetching begins.

### Route Groups

```
app/
├── (public)/              ← No middleware protection; auth pages
│   ├── page.tsx           ← Landing page (/)
│   ├── sign-in/           ← /sign-in
│   ├── sign-up/           ← /sign-up
│   ├── verify/            ← /verify?email=...
│   ├── forgot-password/   ← /forgot-password
│   ├── reset-password/    ← /reset-password (new password only)
│   └── layout.tsx         ← Centered card layout
│
├── (app)/                 ← Middleware-protected; authenticated UI
│   ├── dashboard/         ← /dashboard
│   ├── settings/          ← /settings (profile + sign-out)
│   ├── projects/          ← /projects
│   ├── chat/              ← /chat
│   └── layout.tsx         ← AppLayout (sidebar + header)
│
├── auth/
│   └── callback/route.ts  ← Supabase auth callback (code exchange)
│
└── api/
    ├── user/              ← GET/PATCH user profile
    ├── projects/          ← CRUD projects
    └── chat/              ← Stream + conversations + messages
```

---

## 3. Security Model

### Cookie Management

Supabase `@supabase/ssr` manages auth cookies automatically. The cookies are:

| Cookie | Purpose |
|--------|---------|
| `sb-<ref>-auth-token` | Supabase session (access + refresh tokens, chunked if large) |

Cookie attributes are managed by Supabase's SSR library. The middleware client (`createMiddlewareSupabase`) propagates cookie updates from Supabase to the response.

### JWT Validation

| Location | Runtime | Method | Network Required |
|----------|---------|--------|------------------|
| Middleware (proxy.ts) | Edge | `supabase.auth.getUser()` | Yes (Supabase API) |
| API routes (server.ts) | Node | `supabase.auth.getUser()` | Yes (Supabase API) |
| Bearer token (mobile) | Node | Standalone client with auth header | Yes |

**Why `getUser()` everywhere?** Unlike the previous Cognito setup which had a lightweight expiry-only check in middleware, Supabase's `getUser()` validates the JWT server-side on every call. This is the [recommended approach](https://supabase.com/docs/guides/auth/server-side/nextjs) — `getSession()` only reads the JWT without validation.

### Auth Callback

The `/auth/callback` route handles Supabase auth redirects (e.g., password reset email links). It exchanges an auth code for a session:

```typescript
const { searchParams } = new URL(request.url);
const code = searchParams.get("code");
if (code) {
  await supabase.auth.exchangeCodeForSession(code);
}
```

**Open redirect protection**: The `next` parameter is validated to start with `/` and not `//`.

### Authenticated User Redirect

The middleware redirects users who already have a valid session away from auth pages (`/sign-in`, `/sign-up`, `/verify`, `/forgot-password`, `/reset-password`) to `/dashboard`. This prevents the common UX issue of authenticated users seeing login forms.

### Redirect Preservation

When an unauthenticated user hits a protected route (e.g., `/projects/123`), the middleware redirects to `/sign-in?redirect=/projects/123`. After successful sign-in, the sign-in page reads this param and navigates to the intended destination.

**Open redirect protection**: The `redirect` parameter on sign-in is validated to start with `/` and not `//`.

---

## 4. End-to-End Functional Flows

### 4.1 Sign-Up Flow

```
User fills sign-up form (name, email, password, confirmPassword)
    │
    ▼
Client-side Zod validation (signUpSchema with .refine for password match)
    │
    ▼
useAuth().signUp(email, password, name)
    │  supabase.auth.signUp({ email, password, options: { data: { name } } })
    │  Returns { needsVerification: true }
    │
    ▼
Router navigates to /verify?email=user@example.com
    │
    ▼
Supabase sends 6-digit OTP code to email
    │
    ▼
User enters code → useAuth().confirmSignUp(email, code)
    │  supabase.auth.verifyOtp({ email, token: code, type: "signup" })
    │  On success: auto sign-in, create session with device
    │
    ▼
Router navigates to /dashboard
```

**Resend Code:** If the code expires or doesn't arrive, the user clicks "Resend Code" on the verify page, which calls `useAuth().resendCode(email)` → `supabase.auth.resend({ type: "signup", email })`.

### 4.2 Sign-In Flow

```
User fills sign-in form (email, password)
    │
    ▼
useAuth().signIn(email, password)
    │  supabase.auth.signInWithPassword({ email, password })
    │
    ├── Success (user returned)
    │       │
    │       ▼
    │   setUser({ userId, email, name })
    │   createSessionWithDevice()
    │       │  POST /api/user/sessions (with deviceInfo)
    │       │  Returns sessionId → stored in localStorage
    │   startHeartbeat()
    │       │
    │       ▼
    │   Router navigates to redirect param or /dashboard
    │
    └── Error
            │  getAuthErrorMessage() maps to user-friendly message
            │  Displayed in form
```

### 4.3 Sign-Out Flow

```
User clicks "Sign Out"
    │
    ▼
useAuth().signOut()
    │  End session: POST /api/user/sessions/[id] (endedReason: user_logout)
    │  supabase.auth.signOut() → clears session cookies
    │  setUser(null)
    │  stopHeartbeat()
    │
    ▼
Router navigates to /
    │
    ▼
Next request to protected route → middleware redirects to /sign-in
```

### 4.4 Forgot Password / Reset Password Flow

```
User clicks "Forgot password?" on sign-in page
    │
    ▼
/forgot-password page
    │  User enters email
    │  useAuth().forgotPassword(email)
    │       │  supabase.auth.resetPasswordForEmail(email, { redirectTo })
    │       │  Supabase sends email with reset link
    │
    ▼
User clicks link in email → /auth/callback?code=<code>&next=/reset-password
    │  Callback route exchanges code for session
    │
    ▼
/reset-password page (user now has valid session from code exchange)
    │  User enters new password + confirm password
    │  useAuth().confirmResetPassword(newPassword)
    │       │  supabase.auth.updateUser({ password: newPassword })
    │
    ▼
Router navigates to /sign-in
```

### 4.5 Protected API Request Flow

```
Client hook calls apiFetch("/api/user")
    │  Browser automatically includes Supabase auth cookies
    │
    ▼
requireAuthContext(request)
    │  Tries Authorization: Bearer header first (mobile)
    │  Falls back to cookie auth via createServerSupabase()
    │  supabase.auth.getUser() → validates JWT server-side
    │  Returns AuthContext { userId, email } or throws 401
    │
    ├── getOrCreateUser(supabaseId, email, name)
    │       │  Runs outside UoW (no tenant ID yet)
    │       │  SELECT from users WHERE supabase_id = ?
    │       │  If not found: INSERT INTO users RETURNING *
    │       │  Returns User { id (uuid), supabaseId, email, name }
    │
    ├── makeDeps() → { uow, readOnly }
    │
    ├── handler(deps, input, ctx)
    │       │  deps.uow.execute(userId, async (tx) => { ... })
    │       │    BEGIN transaction
    │       │    SET LOCAL statement_timeout
    │       │    SET LOCAL app.current_tenant_id = '<uuid>'
    │       │    Service calls with (tx, userId, ...)
    │       │    COMMIT
    │
    └── Returns Response.json(result)
```

### 4.6 Token Refresh Flow (Background)

Supabase `@supabase/ssr` handles token refresh automatically via cookies. When a request arrives with an expired access token but valid refresh token, the Supabase client refreshes the session and updates cookies transparently.

The app also maintains a **heartbeat** (separate from token refresh):
- Every 15 minutes: PATCH `/api/user/sessions/[sessionId]` to update `lastActiveAt`
- This tracks user activity for the session management UI

### 4.7 Middleware Decision Flow

```
Incoming request to pathname
    │
    ├── Is API route, static file, or /auth/callback? → PASS THROUGH
    │
    ├── Create Supabase middleware client (cookie propagation)
    │   Call supabase.auth.getUser()
    │
    ├── Is auth page AND user exists?
    │       → REDIRECT to /dashboard
    │
    ├── Is NOT public AND no user?
    │       → REDIRECT to /sign-in?redirect=<pathname>
    │
    └── Otherwise → return response (with cookie updates)
```

---

## 5. File Inventory

### 5.1 Auth Module (`src/auth/`)

| File | Type | Exports | Purpose |
|------|------|---------|---------|
| `types.ts` | Types | `AuthUser` | Shared TypeScript interfaces |
| `context.ts` | React Context | `AuthContext`, `useAuth()` | React context definition and consumer hook |
| `provider.tsx` | React Provider | `AuthProvider` | State management, Supabase auth operations, session/heartbeat |
| `server.ts` | Server Utils | `getServerUser()`, `getServerUserFromRequest()` | Server-side auth via Supabase (cookie + Bearer) |
| `validation.ts` | Schemas | `signInSchema`, `signUpSchema`, `verifySchema`, `forgotPasswordSchema`, `resetPasswordSchema` + inferred types | Zod schemas for all auth forms |
| `errors.ts` | Error Mapping | `getAuthErrorMessage()`, `ValidationError` | Supabase error messages to user-friendly strings |

### 5.2 Supabase Client Helpers (`src/lib/supabase/`)

| File | Exports | Purpose |
|------|---------|---------|
| `client.ts` | `createBrowserClient()` | Browser-side Supabase client |
| `server.ts` | `createServerSupabase()` | Server component / API route Supabase client (cookie-based) |
| `middleware.ts` | `createMiddlewareSupabase()` | Middleware Supabase client (cookie propagation via NextResponse) |
| `admin.ts` | `getSupabaseAdmin()` | Service-role admin client (lazy singleton) |

### 5.3 Server Layer (`src/server/`)

| File | Exports | Purpose |
|------|---------|---------|
| `require-auth-context.ts` | `requireAuthContext()` | Resolves auth from request → `AuthContext` (no transaction) |
| `auth-context.ts` | `AuthContext` | TypeScript type with `supabaseId` field |
| `errors.ts` | `AppError`, `handleAppError()` | Error hierarchy + HTTP error response mapping |
| `make-deps.ts` | `makeDeps()` | Composition root returning `{ uow, readOnly }` singleton |
| `uow/drizzle-uow.ts` | `DrizzleUoW`, `DrizzleReadOnly` | UoW opens transaction, sets `app.current_tenant_id` + statement timeout |
| `uow/types.ts` | `UnitOfWork`, `ReadOnlyExecutor` | Interfaces for command/query separation |

### 5.4 Shared Utilities (`src/lib/`)

| File | Exports | Purpose |
|------|---------|---------|
| `auth.ts` | `getOrCreateUser()` | Links Supabase identity to database user row (runs outside UoW) |
| `api-client.ts` | `apiFetch()`, `configureApiClient()` | Fetch wrapper used by all client-side hooks |
| `api-response.ts` | `unauthorized()`, `notFound()`, `badRequest()`, `serverError()`, `success()`, `created()`, `noContent()`, `forbidden()` | Standardized NextResponse helpers |

### 5.5 API Routes

| Route | Methods | Auth | Purpose |
|-------|---------|------|---------|
| `app/auth/callback/` | GET | None* | Supabase auth code exchange (email links) |
| `app/api/user/` | GET, PATCH | Required | Read/update current user profile |
| `app/api/user/account/` | DELETE | Required | Self-service account deletion |
| `app/api/user/sessions/` | GET, POST, DELETE | Required | Session management |
| `app/api/user/sessions/[id]/` | DELETE, PATCH | Required | Single session revoke/heartbeat |
| `app/api/user/devices/` | GET | Required | List devices |
| `app/api/user/devices/[id]/` | DELETE | Required | Remove device |
| `app/api/user/login-history/` | GET | Required | Login history |
| `app/api/projects/` | CRUD | Required | Project management |
| `app/api/chat/` | Various | Required | Chat conversations, messages, streaming |

*The callback route validates the auth code with Supabase before establishing a session.

### 5.6 Pages

| Route | File | Auth State | Purpose |
|-------|------|------------|---------|
| `/` | `app/(public)/page.tsx` | Public | Landing page with sign-in/sign-up links |
| `/sign-in` | `app/(public)/sign-in/page.tsx` | Public* | Email + password sign-in form |
| `/sign-up` | `app/(public)/sign-up/page.tsx` | Public* | Registration with confirm password |
| `/verify` | `app/(public)/verify/page.tsx` | Public* | 6-digit OTP email verification + resend |
| `/forgot-password` | `app/(public)/forgot-password/page.tsx` | Public* | Request password reset email |
| `/reset-password` | `app/(public)/reset-password/page.tsx` | Public* | Enter new password (after email link) |
| `/dashboard` | `app/(app)/dashboard/page.tsx` | Protected | Main dashboard |
| `/settings` | `app/(app)/settings/page.tsx` | Protected | Profile, security, account tabs |
| `/projects` | `app/(app)/projects/page.tsx` | Protected | Project list and management |
| `/chat` | `app/(app)/chat/page.tsx` | Protected | AI chat interface |

*Auth pages redirect to `/dashboard` if user already has a valid session.

### 5.7 Database Schema (Users)

```sql
CREATE TABLE users (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    supabase_id TEXT NOT NULL UNIQUE,
    email       TEXT NOT NULL UNIQUE,
    name        TEXT,
    status      TEXT DEFAULT 'active',
    created_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ DEFAULT now()
);
```

---

## 6. Calling Patterns & Dependency Graph

### 6.1 Import/Dependency Map

```
                        ┌─────────────┐
                        │  types.ts   │  (no dependencies)
                        └──────┬──────┘
                               │ imported by
                 ┌─────────────┼──────────────┐
                 ▼             ▼              ▼
          ┌────────────┐ ┌──────────┐  ┌──────────────┐
          │ context.ts │ │ server.ts│  │ validation.ts│
          └─────┬──────┘ └────┬─────┘  └──────────────┘
                │             │
                ▼             │
          ┌────────────────┐  │
          │  provider.tsx  │  │        ┌────────────┐
          │  (imports       │  │        │  errors.ts │
          │   context.ts,   │  │        └─────┬──────┘
          │   types.ts,     │  │              │
          │   supabase/     │  │              │
          │   client.ts)    │  │              │
          └────────┬───────┘  │              │
                   │          │              │
                   │          ▼              │
                   │   ┌──────────────┐     │
                   │   │ supabase/    │     │
                   │   │ server.ts    │     │
                   │   │ middleware.ts│     │
                   │   └──────────────┘     │
                   │                        │
                   ▼                        ▼
            ┌────────────────────────────────────┐
            │          Auth Pages                │
            │  sign-in, sign-up, verify,         │
            │  forgot-password, reset-password   │
            │  (import context.ts, validation.ts,│
            │   errors.ts)                       │
            └────────────────────────────────────┘

          ┌────────────┐
          │  proxy.ts  │  (imports supabase/middleware.ts)
          └────────────┘

    ┌───────────────────────────┐     ┌──────────────────┐
    │ require-auth-context.ts   │────▶│  server.ts        │
    └───────────────────────────┘     └──────────────────┘

    ┌───────────────────────────┐     ┌──────────────────┐
    │ make-deps.ts              │────▶│  drizzle-uow.ts  │
    └───────────────────────────┘     └──────────────────┘

    ┌───────────────────────────┐     ┌──────────────────┐
    │ API route handlers        │────▶│  require-auth-   │
    │ (app/api/*)               │────▶│  context.ts      │
    │                           │────▶│  make-deps.ts    │
    │                           │────▶│  errors.ts       │
    │                           │────▶│  lib/auth.ts     │
    └───────────────────────────┘     └──────────────────┘
```

### 6.2 Function Call Chains

**Sign-in (client → server):**
```
SignInForm.onSubmit()
  → useAuth().signIn(email, password)
    → supabase.auth.signInWithPassword()          [Supabase Auth]
    → setUser({ userId, email, name })
    → createSessionWithDevice()
      → POST /api/user/sessions (with deviceInfo)
      → Returns sessionId → localStorage
    → startHeartbeat() (15-min interval)
  → router.push(redirect)
```

**Protected API call:**
```
useUser() → apiFetch("/api/user")
  → requireAuthContext(request)
    → supabase.auth.getUser()                     [Supabase Auth]
    → returns AuthContext { userId, email, supabaseId }
  → getOrCreateUser(supabaseId, email, name)      [runs outside UoW]
    → SELECT/INSERT users                          [Drizzle → PostgreSQL]
  → makeDeps() → { uow, readOnly }
  → handler(deps, input, ctx)
    → deps.uow.execute(userId, async (tx) => { ... })
      → SET LOCAL app.current_tenant_id            [PostgreSQL RLS]
      → service(tx, userId, ...)
```

**Middleware (per-request):**
```
middleware(request)                                 [Edge Runtime]
  → createMiddlewareSupabase(request)               [cookie propagation]
  → supabase.auth.getUser()                         [validates JWT]
  → pathname matching (public? auth page?)
  → NextResponse.redirect() or return response
```

### 6.3 State Management

| State | Location | Updated By | Consumed By |
|-------|----------|------------|-------------|
| Auth user | `AuthContext` | `signIn()`, `signOut()`, initial `getUser()` | `useAuth()` in any client component |
| Session cookies | Supabase-managed cookies | `@supabase/ssr` (automatic) | Middleware, `requireAuthContext()` |
| App session | `localStorage` (`mayfly_session_id`) | `createSessionWithDevice()` | Heartbeat, sign-out |
| Database user | PostgreSQL `users` | `getOrCreateUser()` | All protected API routes |

---

## 7. Environment Variables

| Variable | Required | Client | Purpose |
|----------|----------|--------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Yes | Supabase anonymous/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | No | Supabase service role key (admin operations) |
| `NODE_ENV` | Auto | No | Controls cookie security flags |

Client-exposed variables use the `NEXT_PUBLIC_` prefix because the Supabase browser client needs them.

---

## 8. Token Lifecycle

```
T=0      User signs in
         ├── Supabase issues: access_token (1hr), refresh_token (configurable)
         ├── @supabase/ssr stores tokens in HttpOnly cookies
         └── App creates session record in DB

Ongoing  On each request to middleware/API:
         ├── @supabase/ssr checks access_token expiry
         ├── If expired: automatically refreshes using refresh_token
         └── Updated tokens written to response cookies

T+15min  Heartbeat timer fires
         └── PATCH /api/user/sessions/[id] → updates lastActiveAt

Refresh  Token expires:
token    ├── supabase.auth.getUser() returns error
expiry   ├── Middleware detects no user → redirects to /sign-in
         └── Session record remains for login history

Manual sign-out at any time:
         ├── End session record in DB
         ├── supabase.auth.signOut() clears cookies
         └── setUser(null) clears React state
```

### Error Mapping

When Supabase Auth operations fail, `getAuthErrorMessage()` translates error messages to user-friendly text:

| Supabase Error Message | User-Facing Message | Context |
|------------------------|---------------------|---------|
| `Invalid login credentials` | "Incorrect email or password." | Sign-in |
| `Email not confirmed` | "Your email has not been verified. Please check your inbox." | Sign-in |
| `User already registered` | "An account with this email already exists." | Sign-up |
| `Otp has expired or is invalid` | "Invalid or expired verification code. Please try again." | Verify |
| `For security purposes, you can only request this after...` | "Too many attempts. Please try again later." | Any |
| `Email rate limit exceeded` | "Too many emails sent. Please try again later." | Any |
| `Auth session missing` | "Your reset link has expired. Please request a new one." | Reset |
| `Failed to fetch` | "Network error. Please check your connection and try again." | Any |

If no specific mapping exists, context-specific defaults are returned (e.g., "Unable to sign in." for sign-in context).
