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
- **AWS Bedrock** (Haiku 4.5) for AI/LLM reasoning

## Project Structure

```
app/
├── (public)/           # No auth required (landing, sign-in, sign-up, verify)
├── (app)/              # Auth required (dashboard, clients, employees, visits, settings)
├── auth/callback/      # Supabase auth callback (code exchange)
├── api/
│   └── v1/             # Versioned API (rewrites map /api/* → /api/v1/*)
│       ├── user/           # GET/PATCH user profile
│       ├── user/account/   # DELETE self-service account deletion
│       ├── user/sessions/  # GET/POST/DELETE sessions, [id] revoke/heartbeat
│       ├── user/devices/   # GET devices, [id] remove device
│       ├── user/login-history/ # GET login history
│       ├── alaya-clients/  # GET clients (AlayaCare proxy)
│       ├── employees/      # GET employees, [id]/skills
│       ├── skills/         # GET skills reference data
│       ├── visits/         # GET/POST visits, [id] detail, [id]/offers, [id]/match, [id]/recommend
│       ├── availability/  # POST combined availability query (client_id + date → scored caregivers)
│       ├── webhooks/alayacare/ # POST webhook receiver (M2M auth, idempotent, event dispatch)
│       ├── roster/             # Roster task management
│       │   ├── route.ts         # GET list + POST create roster tasks
│       │   ├── [id]/route.ts    # GET/PATCH individual roster task
│       │   ├── audit/route.ts   # GET audit log (search + filter)
│       │   └── analytics/route.ts # GET analytics (daily metrics + totals)
│       ├── dev/                    # Development/admin tools (temporary — will be removed)
│       │   ├── reset/route.ts      # POST reset rostering data (truncates 4 tables)
│       │   └── simulate-response/route.ts # POST simulate SMS caregiver response
│       └── chat/
│           └── stream/route.ts  # POST SSE chat stream (read tools + write tools with confirmation)
├── layout.tsx          # Root layout with providers
└── globals.css

scripts/
├── run-migration.ts              # Run SQL migrations via direct Postgres connection
├── run-evaluation.ts             # PoC 2 evaluation runner (32 scenarios, --scenario, --dry-run)
├── test-auth-uid.ts              # Test auth.uid() with direct postgres connections
└── migrate-users-to-supabase.ts  # One-time Cognito → Supabase user migration

components/
├── app-layout.tsx      # Sidebar + header layout (breadcrumbs + user button)
├── app-sidebar.tsx     # Navigation sidebar
├── user-button.tsx     # Profile avatar dropdown (settings links + sign out)
├── page-breadcrumbs.tsx # Auto-generated breadcrumbs from URL path
├── breadcrumb-context.tsx # Context for detail page labels (useBreadcrumbLabel)
├── account-status-handler.tsx # Suspended/deleted account overlay
├── theme-provider.tsx  # Theme context
├── theme-toggle.tsx    # Dark/light toggle
├── providers.tsx       # QueryProvider + ThemeProvider
├── match/              # Scoring engine UI
│   └── match-results.tsx # Ranked candidates, dimension bars, preset selector, warnings
├── recommendation/     # LLM recommendation UI
│   └── recommendation-panel.tsx # AI recommendation with explanation, escalation, factors, trade-offs
├── visit/              # Visit detail components
│   └── visit-detail-card.tsx # Clock_in/clock_out, status badges, shift status monitoring
├── ui/                 # shadcn/ui components (incl. badge, breadcrumb)
├── settings/           # Settings tab components
│   ├── profile-tab.tsx
│   ├── security-tab.tsx
│   ├── account-tab.tsx
│   ├── login-history-dialog.tsx
│   └── device-icon.tsx

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
│   ├── schema.ts       # users, projects, meetings, chat, userDevices, userSessions, userStatusHistory, workflowEvents
│   └── migrations/     # SQL migrations (001-011)
├── hooks/
│   ├── use-user.ts     # User profile + delete account (with cache invalidation)
│   ├── use-sessions.ts # Sessions, devices, login history (with optimistic updates)
│   ├── use-alaya-clients.ts # AlayaCare clients (care recipients)
│   ├── use-employees.ts     # AlayaCare employees + employee skills
│   ├── use-skills.ts        # AlayaCare skills reference data
│   ├── use-visits.ts        # AlayaCare visits + offers + create mutations
│   ├── use-visit.ts         # Single visit detail (GET by ID)
│   ├── use-match.ts         # Scoring engine match results (POST mutation via TanStack Query)
│   ├── use-recommendation.ts # LLM recommendation (scoring + reasoning pipeline via TanStack Query)
│   └── use-debounce.ts      # Generic useDebouncedValue hook
├── lib/
│   ├── api-client.ts   # apiFetch wrapper (mobile-ready, 403 status interceptor)
│   ├── api-response.ts # Response helpers (forbidden, getClientIp)
│   ├── logger.ts       # Structured logger (JSON in prod, readable in dev, LOG_LEVEL env)
│   ├── sse.ts          # createSSEResponse() helper for Server-Sent Events
│   ├── supabase/       # Supabase client helpers (client, server, middleware, admin)
│   ├── tenant.ts       # TransactionClient type export
│   ├── auth.ts         # getOrCreateUser helper (bootstrap, bypasses RLS)
│   ├── device-detection.ts # Client-side device fingerprinting
│   ├── visit-status.ts    # getShiftStatus() pure function + shared STATUS_COLORS map
│   ├── alayacare-client.ts # Server-side AlayaCare API client (Basic auth, alayaFetch helper)
│   ├── alayacare-cache.ts  # TTL cache with stampede prevention for AlayaCare API data (30s default)
│   ├── webhook-debouncer.ts # Generic event debouncer (buffers burst events, flushes as batch)
│   ├── alayacare-events/  # Webhook event processing pipeline
│   │   ├── types.ts       # AlayaCareEvent Zod schema + 9 event types
│   │   ├── validate-webhook.ts # M2M auth (timing-safe secret comparison)
│   │   ├── dispatcher.ts  # Event handler registry + dispatch
│   │   └── index.ts       # Barrel export
│   └── llm/            # Bedrock Haiku 4.5 client
├── server/
│   ├── auth-context.ts       # AuthContext type (includes traceId)
│   ├── errors.ts             # AppError hierarchy + handleAppError (ExternalServiceError 502, AlayaCare auto-detection)
│   ├── require-auth-context.ts # Auth resolution (cookie + Bearer, accepts traceId)
│   ├── make-deps.ts          # Composition root (UoW + ReadOnly + policies)
│   ├── policies/             # Role-level authorization (noop today, extension point for RBAC)
│   │   ├── project-policy.ts # assertCanCreate/View/Update/Delete
│   │   ├── meeting-policy.ts
│   │   └── chat-policy.ts
│   ├── uow/                  # UnitOfWork pattern
│   │   ├── types.ts          # UnitOfWork, ReadOnlyExecutor interfaces
│   │   └── drizzle-uow.ts    # DrizzleUoW, DrizzleReadOnly (transaction lifecycle logging)
│   ├── commands/             # Write handlers (validated input → policy check → UoW → service)
│   │   ├── webhooks/        # Webhook event handlers (5 handlers + register-handlers)
│   │   └── roster/          # Roster task commands (create, update, process-pending-events with concurrent advancement)
│   └── queries/              # Read handlers (validated input → policy check → ReadOnly → service)
│       └── roster/          # Roster queries (get-task, list-tasks, search-audit-log, get-analytics)
└── services/
    ├── user-service.ts           # Profile CRUD
    ├── user-lifecycle-service.ts  # Status machine, login tracking
    ├── session-service.ts         # Session & device CRUD
    ├── project-service.ts
    ├── meeting-service.ts
    ├── chat-service.ts
    ├── recommendation-context.ts # Shared visit+client context builder (uses MatchResult.fetchedVisit/fetchedClient to skip re-fetch)
    ├── scoring/                  # PoC 1 scoring engine (Sprints 1–3 complete)
    │   ├── types.ts              # All scoring types + FetchedVisitDetail/FetchedClientDetail + shared AlayaCare data shapes
    │   ├── weights.ts            # 5 weight presets (planned, urgent, high_value_client, new_client, efficiency)
    │   ├── constraints.ts        # Hard constraint filters: checkScheduleConflicts() + checkSkillQualifications() + combined checkHardConstraints()
    │   ├── score-skills.ts       # Dimension 1: Skills match (valid_matched / required_count)
    │   ├── score-relationship.ts # Dimension 2: Relationship history (logarithmic + recency)
    │   ├── score-proximity.ts    # Dimension 3: Geographic proximity (Haversine + linear decay)
    │   ├── score-workload.ts     # Dimension 4: Workload balance (Gaussian + asymmetric penalty)
    │   ├── score-acceptance.ts   # Dimension 5: Acceptance likelihood (accepted / resolved)
    │   ├── match-confidence.ts   # Distribution-based match confidence (high/medium/low)
    │   ├── compute-match.ts      # Orchestrator: bulk fetch → 3-step filter → score → rank (carries fetchedVisit/fetchedClient)
    │   └── index.ts              # Barrel export
    ├── reasoning/                # PoC 2 LLM reasoning layer (Sprints 5–6)
    │   ├── types.ts              # LLMRecommendation, VisitContext, ClientContext, HumanBaseline
    │   ├── prompts.ts            # System prompt + context formatting (buildReasoningPrompt)
    │   ├── parse-response.ts     # Zod-validated JSON parsing with markdown fence stripping
    │   ├── reasoning-service.ts  # getRecommendation() — prompt → LLM → parse → validate
    │   ├── scenario-baselines.ts # 32 human decision baselines for scenario evaluation
    │   ├── evaluation/           # Sprint 6: Escalation evaluation framework
    │   │   ├── types.ts          # ScenarioEvaluationResult, EscalationMetrics, EvaluationReport
    │   │   ├── compute-metrics.ts # Confusion matrix: TP/TN/FP/FN, accuracy, sensitivity, precision
    │   │   ├── build-report.ts   # Aggregate report builder with mismatch detection + token usage
    │   │   ├── run-scenario.ts   # Scenario runner: scoring → reasoning → evaluation bridge
    │   │   └── index.ts          # Barrel export
    │   └── index.ts              # Barrel export
    └── rostering/                # Phase 1: Autonomous shift filling
        ├── types.ts              # RosterTask, ContactAttempt, Urgency, CascadeStrategy types
        ├── roster-task-service.ts # CRUD for roster_tasks table
        ├── audit-service.ts      # Append-only audit log (roster_audit_log)
        ├── metrics-service.ts    # Daily metrics materialisation (roster_daily_metrics)
        ├── orchestrator.ts       # State machine workflow (detect → score → reason → contact → assign)
        ├── urgency-classifier.ts # Planned vs urgent classification
        ├── data-validator.ts     # Visit/employee data validation before scoring
        ├── cascade-engine.ts     # Sequential + parallel cascade strategies
        ├── escalation-engine.ts  # Escalation triggers (time, contacts, LLM recommendation)
        ├── communication/        # SMS/email provider abstraction
        │   ├── types.ts          # CommunicationProvider interface
        │   ├── dispatcher.ts     # Send + retry logic
        │   ├── sms-provider.ts   # Mock SMS (Twilio stub)
        │   ├── email-provider.ts # Mock email (SES stub)
        │   └── templates.ts      # Message templates
        ├── chat-tools.ts         # Conversational UI tools (4 read + 3 write with confirmation)
        ├── outcome-tracker.ts    # Task outcome extraction for learning
        ├── pattern-recognition.ts # Pattern analysis (always_declines, client_churn, etc.)
        └── __tests__/            # E2E workflow + performance tests
            ├── e2e-workflow.test.ts   # 10 end-to-end scenario tests
            └── performance.test.ts    # 5 performance benchmarks

src/test/
├── fixtures/                       # Mock data for scoring scenarios
│   ├── mock-employees.ts           # 150 employees (null coords, inactive, on_leave)
│   ├── mock-skills.ts              # Skills for all employees (no skills, expired, expiring)
│   ├── mock-visits.ts              # 55 visits (completed, clocked, offered, cancelled, etc.)
│   ├── mock-offers.ts              # ~800 offers (high accept, high decline, no history)
│   └── index.ts                    # Barrel export

docs/
├── ARCHITECTURE.md                 # Main architecture reference
├── upstash-xano-architecture.md    # Target architecture: Upstash + Xano + Next.js (state machine, CRUD, engine)
├── observability-plan.md           # Monitoring strategy: platform-native (free) vs Datadog APM (paid)
├── scoring-engine-architecture.md  # PoC 1 scoring engine design
├── phase1-rostering-architecture.md # Phase 1 autonomous rostering design
├── poc.txt                         # PoC requirements (from stakeholders)
├── poc-traceability.md             # Requirements → implementation status mapping
├── poc1-edge-cases.md              # Data quality, API limitations, error scenarios
├── poc1-security-assessment.md     # Auth, traceability, compliance assessment
├── poc2-deliverable.md             # PoC 2 formal technical report (LLM reasoning layer)
├── features.md                     # Feature inventory
├── plans/                          # Implementation plans
│   ├── poc-delivery-plan.md        # End-to-end PoC delivery plan
│   ├── scoring-engine-plan.md      # Scoring engine implementation (Sprints 1-2)
│   ├── supabase-auth-migration.md  # Cognito → Supabase migration (complete)
│   ├── cronicle-architecture-migration.md # Layered architecture migration
│   ├── webhook-event-processing-plan.md  # Webhook event processing pipeline
│   ├── restate-migration-plan.md   # Restate migration plan (evaluated alternative)
│   └── xstate-migration-plan.md    # XState + PostgreSQL migration plan (evaluated alternative)
└── general_docs/                   # Evaluations and assessments (reference only)

cdk/                    # AWS CDK infrastructure (Cognito removed, shell for future Bedrock IAM)
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
- `getOrCreateUser` runs outside UoW with direct `db` access (bootstrap exception — D3)

### Route Pattern (Layered Architecture)
- **Transport**: `const traceId = crypto.randomUUID()` → `requireAuthContext(req, traceId)` → `makeDeps()` → handler → `Response.json()`
- **Handlers**: `src/server/commands/` (writes) and `src/server/queries/` (reads) — policy check → validate input via Zod → run business logic (including guards and domain decisions) in UoW
- **Policies**: `src/server/policies/` — role-level authorization checks (noops today, extension point for RBAC). Injected via `deps`.
- **Services**: `src/services/` — pure data access, receive `(tx, userId, ...)`. No business logic or guards — those belong in handlers.
- **Errors**: `handleAppError(err, traceId)` maps `AppError` hierarchy + Zod errors to `{ error: { code, message, details, traceId } }`

### Structured Logging
- `src/lib/logger.ts` — zero-dependency structured logger wrapping `console`
- JSON output in production, human-readable in development
- `LOG_LEVEL` env var controls verbosity: `debug | info | warn | error` (default: `info`)
- `traceId` threaded through `AuthContext` → handlers → error envelope for request correlation
- UoW lifecycle logged at debug level (`uow:start`, `uow:commit`, `uow:rollback`)

### API Versioning
- All API routes live under `app/api/v1/` (alaya-clients, employees, skills, visits, user)
- `next.config.ts` rewrites map `/api/*` → `/api/v1/*` for backwards compatibility
- Auth callback stays unversioned at `app/auth/callback/`
- Client hooks use `/api/*` paths (work via rewrites); update to `/api/v1/*` in future cleanup

### Navigation
- `UserButton` in header: avatar dropdown with profile/settings links + sign out
- `PageBreadcrumbs` in header: auto-generated from URL path with route label mapping
- Detail pages use `useBreadcrumbLabel(entity.name)` to show entity name instead of UUID
- Settings page supports `?tab=profile|security|account` query param for direct tab linking

### Data Fetching
- All hooks use `apiFetch()` from `@/src/lib/api-client` — never bare `fetch()`
- TanStack Query for all client-side data fetching
- Optimistic updates on all mutations

### Forms
- react-hook-form + zod + shadcn/ui Form components

### Database
- Supabase PostgreSQL via `postgres-js` (PgBouncer pooled + direct connections)
- RLS policies on all tables using `auth.uid()` — enforced when connected as `mayfly_app` role (migration 010)
- Currently connected as `postgres` (BYPASSRLS) — tenant isolation relies on service-layer `eq(userId)` WHERE clauses
- UoW sets `request.jwt.claims` per transaction so `auth.uid()` returns the internal `principalId`
- `DrizzleReadOnly` uses `SET TRANSACTION READ ONLY` to prevent accidental writes in queries
- Drizzle ORM for type-safe queries
- Use `integer` (not `boolean`) for boolean columns — driver compatibility
- Tables: `users`, `projects`, `meetings`, `chatConversations`, `chatMessages`, `userStatusHistory`, `userDevices`, `userSessions`, `workflowEvents`, `rosterTasks`, `rosterAuditLog`, `rosterDailyMetrics`

### User Lifecycle
- Status machine: `active` → `suspended`, `suspended` → `active`, `active` → `soft_deleted`
- Services follow `(tx: TransactionClient, userId: string, ...)` pattern
- `user-service.ts` owns profile CRUD; `user-lifecycle-service.ts` owns status transitions
- Status guards live in handlers (e.g., `handleDeleteAccount` checks `status === "active"` before calling `softDeleteUser`)
- Exception: `suspendUser`/`reactivateUser` retain guards in service (no admin handlers yet — documented deviation)
- `session-service.ts` handles sessions, devices, heartbeat, login history
- Session heartbeat every 15 minutes; session TTL 30 days
- `sessionId` persisted in `localStorage` for survival across page refreshes

### Webhook Event Processing
- **Route**: `POST /api/v1/webhooks/alayacare` — M2M auth (shared secret, NOT Supabase user auth)
- **Auth**: `x-webhook-secret` header validated via `timingSafeEqual` in `src/lib/alayacare-events/validate-webhook.ts`
- **Idempotency**: Two-layer — SELECT check + unique constraint catch for race conditions
- **Dispatcher**: Module-level handler registry in `src/lib/alayacare-events/dispatcher.ts`
- **Handlers**: 7 handlers in `src/server/commands/webhooks/` — `handle-visit-vacated` (critical path: scoring + LLM), `handle-visit-created`, `handle-visit-updated`, `handle-visit-cancelled`, `handle-employee-status-changed`, `handle-employee-unavailability`, `handle-client-created`
- **Registration**: Side-effect import of `register-handlers.ts` in route file
- **Storage**: `workflow_events` table (no RLS, no user_id — system data), direct `db` access (no UoW)
- **Debouncer**: Scoring-heavy events (`visit.vacated`, `visit.created`, `visit.updated`) buffered for ~2s via `WebhookDebouncer` — configurable via `WEBHOOK_DEBOUNCE_MS` env var (0 to disable)
- **Cache invalidation**: Employee lifecycle handlers (`handle-employee-status-changed`, `handle-employee-unavailability`) invalidate the cached employee roster on any status/availability change
- **Env var**: `ALAYACARE_WEBHOOK_SECRET` — required, fails 500 if missing
- **Env var**: `WEBHOOK_DEBOUNCE_MS` — debounce window in ms (default 2000, 0 to disable)

### Autonomous Rostering (Phase 1)
- **State machine**: `detected → gathering → scoring → reasoning → contacting → cascading → accepted → assigned → escalated → completed → cancelled`
- **Orchestrator**: `src/services/rostering/orchestrator.ts` — drives tasks through state machine, each step returns `{ nextStatus, data }`
- **Cascade strategies**: sequential (planned shifts) and parallel (urgent shifts) in `cascade-engine.ts`
- **Escalation**: time-based (15min urgent, 60min planned), contact-count-based, and LLM-recommended
- **Communication**: Provider abstraction with mock SMS/email (Twilio/SES stubs for production cutover)
- **Chat tools**: 4 read tools (task status, metrics, recent tasks, count by status) + 3 write tools (create task, assign caregiver, cancel task)
- **Chat write confirmation**: LLM proposes write → SSE sends `confirmation_required` → client confirms → second POST with `confirmed_action` → UoW executes
- **Audit trail**: Append-only `roster_audit_log` table via `appendAudit()` — all state transitions and chat actions logged
- **Daily metrics**: `roster_daily_metrics` table materialised by `metrics-service.ts`
- **Outcome tracking**: `extractOutcome()` in `outcome-tracker.ts` — structured learning data from resolved tasks
- **Pattern recognition**: `analysePatterns()` detects always_declines, never_accepts, client_churn, high escalation rate
- **Acceptance feedback loop**: `score-acceptance.ts` merges AlayaCare offer history with DappaAi contact outcomes using exponential decay (30-day half-life)
- **Optimistic locking**: Write tools read `version`, update with `eq(version)`, return error on concurrent modification

### AlayaCare Integration (PoC)
- Server-side API client in `src/lib/alayacare-client.ts` — `alayaFetch<T>()` with Basic auth
- Requires `ALAYACARE_API_URL`, `ALAYACARE_PUBLIC_KEY`, `ALAYACARE_PRIVATE_KEY` env vars (fails fast if missing)
- API routes are authenticated proxy passthroughs (requireAuthContext + handleAppError, no UoW/policy layer)
- Client hooks import `AlayaPaginatedResponse<T>` from the shared client module (no duplicated types)
- Search inputs debounced via `useDebouncedValue` hook (300ms)
- **TTL cache**: `src/lib/alayacare-cache.ts` — `AlayaCareCache` class with 30s TTL, stampede prevention (concurrent callers share one in-flight fetch), manual invalidation
- **Cached employee roster**: `getEmployeeRoster()` in `compute-match.ts` bulk-fetches active employees + all skills, cached for 30s — eliminates N+1 per-employee skills fetch
- **Cache key**: `CACHE_KEY_EMPLOYEE_ROSTER` — invalidated by `handle-employee-status-changed` and `handle-employee-unavailability` handlers

## Environment Variables

See `.env.example` for all required variables.
