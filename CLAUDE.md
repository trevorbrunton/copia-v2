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
│       ├── demo/              # Tavus avatar runtime (unauthenticated, used by /demo/screen)
│       │   ├── tavus/         # POST — Tavus CVI conversation (create)
│       │   └── tavus/[conversationId]/ # DELETE — End Tavus conversation (cleanup)
│       └── screen/            # Pep screening demo API (unauthenticated)
│           ├── snapshot/         # GET — current ASX snapshot rows
│           ├── apply-filter/     # POST — run a single filter against a ticker set
│           ├── stock-fact/       # POST — resolve ticker/name → snapshot field
│           ├── portfolio-overlap/# POST — Q8 holdings overlap
│           └── process/          # POST — STT (multipart) + intent classification
├── demo/screen/        # Pep screening demo page (no auth)
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
├── demo/               # Shared demo widgets
│   └── persona-selector.tsx # Tavus persona selector (Generic / Custom)
├── screen/             # Pep screening demo components
│   ├── screen-page.tsx       # Top-level layout (avatar + funnel rail + table + chat)
│   ├── avatar-video.tsx      # Tavus video pane
│   ├── conversation-pane.tsx # Pep transcript / chat
│   ├── funnel-rail.tsx       # Stage visualisation
│   ├── stocks-table.tsx      # Filtered universe table
│   ├── stock-fact-panel.tsx  # Single-stock snapshot detail
│   ├── source-badge.tsx      # "Snapshot of YYYY-MM-DD" badge
│   └── staleness-banner.tsx  # Snapshot age warning
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
│   ├── index.ts        # Drizzle client (postgres-js, bundles schema.ts + screen-schema.ts)
│   ├── schema.ts       # users, projects, meetings, chat, userDevices, userSessions, userStatusHistory + orphan demoResponses/demoQuestionPatterns (read by separate v1 app)
│   ├── screen-schema.ts # asxSnapshots, asxSecurities, ocHoldings (Pep screening tables)
│   └── migrations/     # SQL migrations
├── demo/               # Avatar runtime shared with the screening demo
│   ├── use-voice-listener.ts # Continuous VAD + PCM capture
│   └── use-tavus-avatar.ts   # Tavus CVI via Daily.co WebRTC
├── screen/             # Pep screening engine
│   ├── funnel.ts             # Filter engine, FILTER_THRESHOLDS, presets
│   ├── state.ts              # Client-side ScreenState reducer
│   ├── load-snapshot.ts      # JSON merger (universe + ranked-light + top500 + curation)
│   ├── numeric.ts            # Strict parseNumeric helper
│   ├── market-data-provider.ts # SnapshotMarketDataProvider, StockFact
│   ├── intent.ts / intent-rules.ts # Intent union + rule layer
│   ├── entity-resolver.ts    # Ticker + bigram name resolution
│   ├── screen-matcher.ts     # Rule-first → Anthropic classifier fallback
│   ├── narration.ts          # Per-intent spoken-answer templates
│   ├── stt.ts                # ElevenLabs scribe_v1 transcription
│   └── use-screener.ts       # Client hook orchestrating the funnel
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

### Pep Screening Demo (OC Mid-Cap Fund)
- Public page at `/demo/screen` — no auth required (the entire `/demo/*` tree is public)
- Plan + decisions live in `docs/plans/pep-avatar-v2-plan.md`
- Pipeline: VAD → multipart `POST /api/v1/screen/process` (ElevenLabs STT → rule-first matcher → Anthropic Haiku classifier fallback) → funnel mutation + Pep narration via Tavus echo
- Avatar: continuous Tavus CVI WebRTC stream via Daily.co; every assistant narration is `tavusAvatar.echo()`-ed for lip-sync. **The persona must be `pipeline_mode: "echo"`** or you get two parallel voices — see `docs/TAVUS-PERSONA-SETUP.md` for the create/verify steps and `bun scripts/create-tavus-echo-persona.ts` to spin one up
- Snapshot-backed only — no live ASX feed (D3). `MarketDataProvider` interface lives in `src/screen/market-data-provider.ts` for future swap
- Tables: `asx_snapshots`, `asx_securities`, `oc_holdings` (see `src/db/screen-schema.ts`); ingest via `bun scripts/ingest-asx-snapshot.ts`
- `useVoiceListener()` provides continuous voice capture with amplitude-based VAD (silence timeout configurable via `NEXT_PUBLIC_VAD_SILENCE_TIMEOUT_MS`, default 1000ms)
- Tavus conversation cleanup: `DELETE /api/v1/demo/tavus/[conversationId]` ends conversations server-side; also fires on component unmount
- OC Funds brand colors as CSS custom properties (`--oc-navy`, `--oc-dark`, etc.) in `globals.css`
- Env vars: `ELEVENLABS_API_KEY`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL_ID` (optional), `TAVUS_API_KEY`, `TAVUS_REPLICA_ID`, `NEXT_PUBLIC_TAVUS_PERSONA_GENERIC`, `NEXT_PUBLIC_TAVUS_PERSONA_CUSTOM`

### v1 demo decommission (phase 7)
- The v1 OC Mid-Cap demo (`/demo`, `app/api/v1/demo/process`, `app/api/v1/demo/qa`, `/config` admin) was removed in commit `<phase-7>` once v2 went pitch-ready
- v1 Supabase tables (`demo_responses`, `demo_question_patterns`) are intentionally preserved — a separate v1 app still reads them. The orphan exports in `src/db/schema.ts` exist solely to prevent `drizzle-kit generate` from emitting `DROP TABLE` migrations against the shared DB

## Environment Variables

See `.env.example` for all required variables.
