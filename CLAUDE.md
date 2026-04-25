# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Commands

```bash
# Development
bun dev          # Start dev server at localhost:3000

# Build & Production
bun run build    # Build for production
bun start        # Run production build

# Linting
bun run lint     # Run ESLint

# Testing
bun run test     # Run all tests (vitest)

# Database
bun run db:generate  # Generate migrations
bun run db:migrate   # Run migrations
bun run db:push      # Push schema changes (requires DATABASE_URL)
bun run db:studio    # Open Drizzle Studio
bun scripts/run-migration.ts <path-to-sql>  # Run migration via direct Postgres connection
```

## Tech Stack

- **Next.js 16** with App Router
- **React 19**
- **TypeScript 5** (strict mode)
- **Tailwind CSS 4** (using `@import "tailwindcss"` in CSS)
- **Bun** as package manager
- **Supabase Auth** for authentication (standalone module in `src/auth/`)
- **Drizzle ORM** with PostgreSQL (Supabase, via `postgres-js`)
- **TanStack Query** for server state management
- **shadcn/ui** for UI components
- **Radix UI** for accessible primitives
- **Lucide React** for icons

## Project Structure

```
app/
├── (public)/           # No auth required (landing, sign-in, sign-up, verify)
├── (app)/              # Auth required (dashboard, settings)
├── auth/callback/      # Supabase auth callback (code exchange)
├── api/
│   └── v1/             # Versioned API (rewrites map /api/* → /api/v1/*)
│       ├── user/           # GET/PATCH user profile
│       ├── user/account/   # DELETE self-service account deletion
│       ├── user/sessions/  # GET/POST/DELETE sessions, [id] revoke/heartbeat
│       ├── user/devices/   # GET devices, [id] remove device
│       ├── user/login-history/ # GET login history
│       └── demo/              # Investor demo API (unauthenticated)
│           ├── tavus/         # POST — Tavus CVI conversation (create)
│           ├── tavus/[conversationId]/ # DELETE — End Tavus conversation (cleanup)
│           ├── process/       # POST — Unified STT (ElevenLabs) + classification (Anthropic Haiku)
│           └── qa/            # CRUD for demo Q&A pairs (admin, auth-protected)
├── demo/               # Public investor demo page (no auth)
├── layout.tsx          # Root layout with providers
└── globals.css

scripts/
├── run-migration.ts              # Run SQL migrations via direct Postgres connection
├── test-auth-uid.ts              # Test auth.uid() with direct postgres connections
└── migrate-users-to-supabase.ts  # One-time Cognito → Supabase user migration

components/
├── app-layout.tsx      # Sidebar + header layout (breadcrumbs + user button)
├── app-sidebar.tsx     # Navigation sidebar (Dashboard, Settings)
├── user-button.tsx     # Profile avatar dropdown (settings links + sign out)
├── page-breadcrumbs.tsx # Auto-generated breadcrumbs from URL path
├── breadcrumb-context.tsx # Context for detail page labels (useBreadcrumbLabel)
├── account-status-handler.tsx # Suspended/deleted account overlay
├── theme-provider.tsx  # Theme context
├── theme-toggle.tsx    # Dark/light toggle
├── providers.tsx       # QueryProvider + ThemeProvider
├── ui/                 # shadcn/ui components (incl. badge, breadcrumb)
├── demo/               # Investor demo page components
│   ├── demo-page.tsx   # Main layout (header + avatar + chat)
│   ├── avatar-panel.tsx # Dual-layer video (idle loop + response overlay, no flicker)
│   ├── chat-panel.tsx  # Message list with typing indicator
│   ├── chat-input.tsx  # Text input + voice input (Web Speech API)
│   ├── status-badge.tsx # Status indicator (ready/listening/thinking/speaking)
│   └── error-banner.tsx # Dismissable error display
└── settings/           # Settings tab components
    ├── profile-tab.tsx
    ├── security-tab.tsx
    ├── account-tab.tsx
    ├── login-history-dialog.tsx
    └── device-icon.tsx

src/
├── auth/               # Standalone Supabase auth module
│   ├── provider.tsx    # AuthProvider (email/password, sessions, heartbeat)
│   ├── context.ts      # useAuth hook (sessionId, updatePassword)
│   ├── errors.ts       # Supabase error → user-friendly message mapping
│   ├── types.ts        # AuthUser, AuthState types
│   ├── server.ts       # Server-side auth (getServerUser, getServerUserFromRequest)
│   ├── validation.ts   # Zod schemas for auth & profile forms
│   └── index.ts        # Public API exports
├── db/
│   ├── index.ts        # Drizzle client (postgres-js)
│   ├── schema.ts       # users, projects, meetings, chat, userDevices, userSessions, userStatusHistory, demoResponses, demoQuestionPatterns
│   └── migrations/     # SQL migrations
├── demo/               # Investor demo module (OC Mid-Cap Fund)
│   ├── config.ts       # Avatar mode flags (tavus | haiku), persona
│   ├── types.ts        # ChatMessage, DemoStatus
│   ├── classifier.ts   # Static PREGENERATED response map (30 categories with media URLs)
│   ├── bedrock-matcher.ts # Anthropic Haiku question classifier (DB-backed, cached)
│   ├── use-voice-listener.ts # Continuous VAD + PCM capture (AudioContext, configurable silence timeout)
│   ├── use-tavus-avatar.ts # useTavusAvatar hook (Tavus CVI via Daily.co WebRTC)
│   ├── use-demo.ts     # useDemo hook (VAD → process → playResponse)
│   └── index.ts        # Public API exports
├── hooks/
│   ├── use-user.ts     # User profile + delete account (with cache invalidation)
│   ├── use-sessions.ts # Sessions, devices, login history (with optimistic updates)
│   └── use-debounce.ts # Generic useDebouncedValue hook
├── lib/
│   ├── api-client.ts   # apiFetch wrapper (mobile-ready, 403 status interceptor)
│   ├── api-response.ts # Response helpers (forbidden, getClientIp)
│   ├── logger.ts       # Structured logger (JSON in prod, readable in dev, LOG_LEVEL env)
│   ├── supabase/       # Supabase client helpers (client, server, middleware, admin)
│   ├── tenant.ts       # TransactionClient type export
│   ├── auth.ts         # getOrCreateUser helper (bootstrap, bypasses RLS)
│   └── device-detection.ts # Client-side device fingerprinting
├── server/
│   ├── auth-context.ts       # AuthContext type (includes traceId)
│   ├── errors.ts             # AppError hierarchy + handleAppError
│   ├── require-auth-context.ts # Auth resolution (cookie + Bearer, accepts traceId)
│   ├── make-deps.ts          # Composition root (UoW + ReadOnly)
│   ├── policies/             # Role-level authorization (noop today, extension point for RBAC)
│   ├── uow/                  # UnitOfWork pattern
│   │   ├── types.ts          # UnitOfWork, ReadOnlyExecutor interfaces
│   │   └── drizzle-uow.ts   # DrizzleUoW, DrizzleReadOnly (transaction lifecycle logging)
│   ├── commands/             # Write handlers
│   │   ├── sessions/         # Session management commands
│   │   └── users/            # User profile commands
│   └── queries/              # Read handlers
│       └── users/            # User profile queries
└── services/
    ├── user-service.ts           # Profile CRUD
    ├── user-lifecycle-service.ts  # Status machine, login tracking
    └── session-service.ts         # Session & device CRUD

cdk/                    # AWS CDK infrastructure (shell for future use)
├── lib/mayfly-stack.ts # Minimal stack placeholder
└── deploy.sh
```

## Key Patterns

### Path Aliases
Use `@/*` to import from the project root.

### Authentication
- Supabase Auth module in `src/auth/` (email/password only, MFA deferred)
- `@supabase/ssr` handles cookie management automatically (client, server, middleware helpers in `src/lib/supabase/`)
- `useAuth()` hook for client-side auth state (includes `sessionId`, `updatePassword`)
- `requireAuthContext(req, traceId)` resolves auth → `AuthContext` (principalId, supabaseId, email, roles, traceId)
- Supports both cookie (web) and Bearer token (mobile) auth
- Email verification via OTP code (6-digit) on `/verify` page
- Password reset via email link → `/auth/callback` → `/reset-password` (new password only)
- `proxy.ts` middleware uses Supabase session; redirects unauthed to `/sign-in`, authed on public routes to `/dashboard`
- Account status checks: suspended/deleted users get 403 with status codes
- `apiFetch()` intercepts 403 status responses and dispatches `account-status-error` events
- `AccountStatusHandler` component shows force-sign-out overlay for suspended/deleted accounts
- `getOrCreateUser` runs outside UoW with direct `db` access (bootstrap exception)

### Route Pattern (Layered Architecture)
- **Transport**: `const traceId = crypto.randomUUID()` → `requireAuthContext(req, traceId)` → `makeDeps()` → handler → `Response.json()`
- **Handlers**: `src/server/commands/` (writes) and `src/server/queries/` (reads) — policy check → validate input via Zod → run business logic in UoW
- **Policies**: `src/server/policies/` — role-level authorization checks (noops today, extension point for RBAC)
- **Services**: `src/services/` — pure data access, receive `(tx, userId, ...)`. No business logic or guards — those belong in handlers.
- **Errors**: `handleAppError(err, traceId)` maps `AppError` hierarchy + Zod errors to `{ error: { code, message, details, traceId } }`

### Structured Logging
- `src/lib/logger.ts` — zero-dependency structured logger wrapping `console`
- JSON output in production, human-readable in development
- `LOG_LEVEL` env var controls verbosity: `debug | info | warn | error` (default: `info`)
- `traceId` threaded through `AuthContext` → handlers → error envelope for request correlation
- UoW lifecycle logged at debug level (`uow:start`, `uow:commit`, `uow:rollback`)

### API Versioning
- All API routes live under `app/api/v1/`
- `next.config.ts` rewrites map `/api/*` → `/api/v1/*` for backwards compatibility
- Auth callback stays unversioned at `app/auth/callback/`

### Navigation
- `UserButton` in header: avatar dropdown with profile/settings links + sign out
- `PageBreadcrumbs` in header: auto-generated from URL path with route label mapping
- Settings page supports `?tab=profile|security|account` query param for direct tab linking

### Data Fetching
- All hooks use `apiFetch()` from `@/src/lib/api-client` — never bare `fetch()`
- TanStack Query for all client-side data fetching
- Optimistic updates on all mutations

### Forms
- react-hook-form + zod + shadcn/ui Form components

### Database
- Supabase PostgreSQL via `postgres-js` (PgBouncer pooled + direct connections)
- RLS policies on tables using `auth.uid()`
- UoW sets `request.jwt.claims` per transaction so `auth.uid()` returns the internal `principalId`
- `DrizzleReadOnly` uses `SET TRANSACTION READ ONLY` to prevent accidental writes in queries
- Drizzle ORM for type-safe queries
- Use `integer` (not `boolean`) for boolean columns — driver compatibility
- Tables: `users`, `projects`, `meetings`, `chatConversations`, `chatMessages`, `userStatusHistory`, `userDevices`, `userSessions`, `demoResponses`, `demoQuestionPatterns`

### User Lifecycle
- Status machine: `active` → `suspended`, `suspended` → `active`, `active` → `soft_deleted`
- Services follow `(tx: TransactionClient, userId: string, ...)` pattern
- `user-service.ts` owns profile CRUD; `user-lifecycle-service.ts` owns status transitions
- `session-service.ts` handles sessions, devices, heartbeat, login history
- Session heartbeat every 15 minutes; session TTL 30 days
- `sessionId` persisted in `localStorage` for survival across page refreshes

### Investor Demo (OC Mid-Cap Fund)
- Public page at `/demo` — no auth required (added to `PUBLIC_ROUTES` in `proxy.ts`)
- Single pipeline: VAD → unified `POST /api/v1/demo/process` (ElevenLabs STT → Anthropic Haiku classifier) → DB responses
- Avatar mode controlled by `NEXT_PUBLIC_AVATAR_MODE`: `"tavus"` | `"haiku"`
  - **`tavus`**: continuous WebRTC stream via Daily.co with echo-based lip-sync (no visual cuts between responses)
  - **`haiku`**: pre-recorded MP4s with idle loop underneath and response video on top (zero-flicker dual-layer)
- Unauthenticated API routes under `/api/v1/demo/` (tavus, tavus/[id], process)
- `useDemo()` hook orchestrates voice input, response matching, and avatar playback
- `useVoiceListener()` provides continuous voice capture with amplitude-based VAD (silence timeout configurable via `NEXT_PUBLIC_VAD_SILENCE_TIMEOUT_MS`, default 1000ms)
- `bedrock-matcher.ts` loads `demoResponses` + `demoQuestionPatterns` from DB (cached), sends to Anthropic Haiku for classification
- Tavus conversation cleanup: `DELETE /api/v1/demo/tavus/[conversationId]` ends conversations server-side; also fires on component unmount
- OC Funds brand colors as CSS custom properties (`--oc-navy`, `--oc-dark`, etc.) in `globals.css`
- Env vars: `ELEVENLABS_API_KEY`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL_ID` (optional), `TAVUS_API_KEY`, `TAVUS_PERSONA_ID`, `TAVUS_REPLICA_ID`

## Environment Variables

See `.env.example` for all required variables.
