# Architecture

System architecture for Dappa AI, a Next.js 16 application for autonomous caregiver shift-filling powered by AlayaCare integration, a multi-dimensional scoring engine, LLM reasoning, and workflow orchestration.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router), React 19 |
| Language | TypeScript 5 (strict mode) |
| Package manager | Bun |
| Auth | Supabase Auth (`@supabase/ssr`, `@supabase/supabase-js`) |
| Database | Supabase PostgreSQL via `postgres-js` |
| ORM | Drizzle ORM |
| Client state | TanStack Query |
| UI | shadcn/ui, Radix UI, Tailwind CSS 4, Lucide React |
| Forms | react-hook-form + Zod v4 |
| AI | AWS Bedrock (Claude Haiku 4.5) |
| Testing | Vitest 4 |

---

## High-Level Architecture

```
Browser                          Server                           External
───────                          ──────                           ────────
                                 proxy.ts
                                 (session refresh, route protection)
                                        │
useAuth() ──── Supabase SDK ──────────► Supabase Auth
                                        │
apiFetch() ──► API Routes ──────► requireAuthContext(req)
                                        │
                              ┌─────────┴─────────┐
                              │                    │
                    makeDeps() → Handlers    alayaFetch() ──► mock-alaya
                              │                    │            (Basic auth)
                    Services (tx, userId)    Scoring + Reasoning
                              │                    │
                    Drizzle ORM ──────────► PostgreSQL   AWS Bedrock
                                           (Supabase)   (Haiku 4.5)
```

### System Layers

```
┌─────────────────────────────────────────────────────────────────┐
│  Human-in-the-Loop Interface (UI)                                │
│  Dashboard, roster tasks, escalation queue, chat, analytics      │
├─────────────────────────────────────────────────────────────────┤
│  Workflow Orchestrator                                           │
│  State machine for autonomous shift-filling lifecycle            │
├──────────────┬──────────────────────────────────────────────────┤
│  LLM Reasoning│  Communication     │  Scoring Engine             │
│  Layer        │  Layer             │  (pure algorithmic)          │
│  Bedrock API  │  SMS, email stubs  │  5-dimension WSM             │
├──────────────┴──────────────────────────────────────────────────┤
│  AlayaCare Integration                                           │
│  alayaFetch → proxy routes → webhooks → event dispatch           │
├─────────────────────────────────────────────────────────────────┤
│  Core Platform                                                   │
│  Auth, UoW, RLS, logging, error handling                         │
└─────────────────────────────────────────────────────────────────┘
```

---

## Directory Structure

```
app/
├── layout.tsx              # Root: AuthProvider → Providers (QueryClient + Theme)
├── (public)/               # No auth required
│   ├── layout.tsx          # Centered flex container
│   ├── sign-in/
│   ├── sign-up/
│   ├── verify/
│   ├── forgot-password/
│   └── reset-password/
├── (app)/                  # Auth required
│   ├── layout.tsx          # AppLayout (sidebar + header) + AccountStatusHandler
│   ├── dashboard/          # Overview with live activity feed
│   ├── clients/            # AlayaCare care recipients
│   ├── employees/          # AlayaCare caregivers with skills
│   ├── visits/             # Visit list + [id] detail (match results, recommendations)
│   ├── roster/             # Roster task list + [id] detail
│   ├── escalations/        # Escalated tasks queue
│   ├── analytics/          # 30-day metrics dashboard
│   ├── chat/               # Conversational interface (SSE + tool use)
│   └── settings/           # Profile, security, account tabs
├── auth/callback/          # Supabase auth callback (code exchange)
└── api/v1/                 # API routes (see API section)

proxy.ts                   # Supabase session refresh + route guards (Next.js 16 default export)

src/
├── auth/                   # Client auth module (Supabase)
├── db/                     # Drizzle client + schema + migrations (001–012)
├── server/                 # Layered architecture (commands, queries, UoW)
│   ├── commands/webhooks/  # 7 webhook event handlers
│   ├── commands/roster/    # Roster task commands (create, update, process-event)
│   └── queries/roster/     # Roster queries (get-task, list-tasks, search-audit, analytics)
├── services/
│   ├── scoring/            # 5-dimension caregiver match scoring engine
│   ├── reasoning/          # LLM reasoning layer (Bedrock Haiku 4.5)
│   ├── rostering/          # Workflow orchestrator, cascade, escalation, audit, chat tools
│   └── communication/      # SMS/email provider abstraction (mock stubs)
├── hooks/                  # TanStack Query hooks
├── lib/
│   ├── alayacare-client.ts # Server-side AlayaCare API client
│   ├── alayacare-events/   # Webhook validation, event schema, dispatcher
│   ├── llm/                # Bedrock Converse API client
│   ├── supabase/           # Supabase client helpers (client, server, middleware, admin)
│   └── sse.ts              # createSSEResponse() helper
└── test/                   # Test helpers, fixtures, integration + unit tests

components/
├── app-layout.tsx          # Sidebar + header
├── app-sidebar.tsx         # Navigation sidebar
├── providers.tsx           # QueryClient + ThemeProvider
├── match/                  # Scoring results UI (ranked candidates, dimension bars, preset selector)
├── recommendation/         # LLM recommendation panel (explanation, escalation, factors)
├── visit/                  # Visit detail card (clock in/out, status badges)
├── rostering/              # Activity feed, task cards, score bars
├── settings/               # Settings tabs (profile, security, account)
└── ui/                     # shadcn/ui primitives (badge, breadcrumb, etc.)
```

---

## Authentication

### Flow

```
Sign-up → Supabase Auth (email OTP verification) → Sign-in
Sign-in → supabase.auth.signInWithPassword → session cookie set by @supabase/ssr
                                            → custom session/device record created
```

### Client Side (`src/auth/`)

| File | Purpose |
|---|---|
| `provider.tsx` | `AuthProvider` — wraps app, manages Supabase auth state via `onAuthStateChange` |
| `context.ts` | `useAuth()` hook — `signIn`, `signUp`, `signOut`, `forgotPassword`, etc. |
| `server.ts` | `getServerUser()` / `getServerUserFromRequest()` — cookie + Bearer token |
| `errors.ts` | Maps Supabase error strings to user-friendly messages |
| `validation.ts` | Zod schemas for all auth forms + client-side rate limiting |
| `types.ts` | `AuthUser { userId, email, name? }`, `AuthState` union |

### Server Side

| File | Purpose |
|---|---|
| `proxy.ts` | Refreshes Supabase session on every request, redirects unauthed/authed users (Next.js 16 proxy) |
| `src/server/require-auth-context.ts` | Resolves auth → `AuthContext { principalId, supabaseId, email, roles, traceId }` |
| `src/lib/auth.ts` | `getOrCreateUser()` — bootstrap path, direct DB access (exception D3) |

### Supabase Clients (`src/lib/supabase/`)

| File | Purpose |
|---|---|
| `client.ts` | Browser client (`createBrowserClient`, anon key) |
| `server.ts` | Server client (`createServerClient`, reads Next.js cookies) |
| `admin.ts` | Admin client (service role key, bypasses RLS) |
| `middleware.ts` | Middleware client helper (reads/writes request/response cookies) |

### Session Management

- Custom session/device tracking in `user_sessions` and `user_devices` tables
- `sessionId` persisted in `localStorage` (`mayfly_session_id`)
- Heartbeat: PATCH every 15 minutes to keep session alive
- Session TTL: 30 days (matches Supabase refresh token)
- Sign-out: ends session record, then calls `supabase.auth.signOut()`
- Account status: suspended/deleted users get 403; `AccountStatusHandler` shows force-sign-out overlay

---

## Layered Architecture

Every API route follows this pattern:

```
HTTP Request
  → traceId = crypto.randomUUID()     # Per-request trace ID
  → requireAuthContext(req, traceId)  # Auth resolution
  → makeDeps()                        # { uow, readOnly, policies } singleton
  → Command or Query handler          # Policy check → business logic
  → Response.json()                   # HTTP response
```

### Layers

```
┌─────────────────────────────────────────────────┐
│  Transport Layer (app/api/v1/)                   │
│  traceId, auth, parse HTTP, call handler         │
├─────────────────────────────────────────────────┤
│  Handler Layer (src/server/commands/ & queries/) │
│  Policy check → validate input (Zod) → UoW      │
├─────────────────────────────────────────────────┤
│  Service Layer (src/services/)                   │
│  Pure data access: (tx, userId, ...) → result    │
├─────────────────────────────────────────────────┤
│  Database (Drizzle ORM → PostgreSQL + RLS)       │
└─────────────────────────────────────────────────┘
```

### Unit of Work (`src/server/uow/`)

| Class | Purpose |
|---|---|
| `DrizzleUoW` | Opens transaction, sets `request.jwt.claims` (so `auth.uid()` works), 30s timeout |
| `DrizzleReadOnly` | Same + `SET TRANSACTION READ ONLY` |

Both inject tenant identity via `SET LOCAL request.jwt.claims = '{"sub": "<principalId>", "role": "authenticated"}'`. This makes `auth.uid()` return the internal `users.id` UUID, which all FK columns (`user_id`) reference — so RLS policies can compare `user_id = auth.uid()` directly without subqueries.

### RLS Enforcement

RLS policies exist on all user-scoped tables using `auth.uid()`:

```sql
-- Example: roster_tasks can only be accessed by their owner
CREATE POLICY roster_tasks_isolation ON roster_tasks
  FOR ALL USING (user_id = auth.uid());
```

**Current state:** The `postgres` connection role has BYPASSRLS, so RLS is not enforced yet. Tenant isolation relies on both:
1. Service-layer `eq(userId)` WHERE clauses (application-level)
2. UoW setting `request.jwt.claims` per transaction (prep for DB-level enforcement)

**To enforce RLS:** Connect as the `mayfly_app` role (migration 010) which does not have BYPASSRLS.

### Policy Layer (`src/server/policies/`)

Role-level authorization checks called by handlers before business logic. All methods are noops today — any authenticated user can perform any action. When roles are added (e.g. `scheduler`, `admin`), these become the enforcement point.

**Important distinction:** Policies check role-level permissions ("can this user type do this at all?"), NOT record-level ownership. Record-level ownership stays in service-layer `userId` WHERE clauses and RLS policies.

### Composition Root (`src/server/make-deps.ts`)

`makeDeps()` returns a singleton `{ uow, readOnly, projectPolicy, meetingPolicy, chatPolicy }`.

### Structured Logging (`src/lib/logger.ts`)

Zero-dependency logger wrapping `console`. Outputs readable format in dev, structured JSON in production. Controlled by `LOG_LEVEL` env var (`debug`, `info`, `warn`, `error`; default: `info`).

Trace IDs are generated at the transport layer (`crypto.randomUUID()`), threaded through `AuthContext`, and included in error response envelopes and UoW transaction lifecycle logs.

### Error Handling (`src/server/errors.ts`)

| Error | HTTP Status |
|---|---|
| `UnauthorizedError` | 401 |
| `ForbiddenError` | 403 |
| `NotFoundError` | 404 |
| `ConflictError` | 409 |
| `ValidationError` | 400 |
| `ExternalServiceError` | 502 |

`handleAppError(err, traceId?)` maps errors to `{ error: { code, message, traceId?, details? } }` envelope. Zod v4 errors are duck-typed via `"issues" in err` (not `instanceof`). `ExternalServiceError` auto-detects AlayaCare errors from error message patterns.

---

## API Routes

All routes live under `/api/v1/`. Per-resource rewrites in `next.config.ts` map `/api/*` → `/api/v1/*` for backwards compatibility.

### AlayaCare Proxy Routes

Authenticated passthroughs to the AlayaCare API (mock-alaya). They use `requireAuthContext` + `handleAppError` but skip the UoW/policy/service layers (data lives in AlayaCare, not our database).

| Method | Route | AlayaCare Endpoint | Purpose |
|---|---|---|---|
| GET | `/api/v1/alaya-clients` | `/ext/api/v2/patients/clients` | List care recipients |
| GET | `/api/v1/employees` | `/ext/api/v2/employees/employees` | List caregivers |
| GET | `/api/v1/employees/[id]/skills` | `/ext/api/v2/employees/employees/{id}/skills` | Employee skills |
| GET | `/api/v1/skills` | `/ext/api/v2/employees/skills` | Skills reference data |
| GET | `/api/v1/visits` | `/ext/api/v2/scheduler/visits` | List visits (filter by status/date/client/employee) |
| POST | `/api/v1/visits` | `/ext/api/v2/scheduler/visits` | Create visit |
| GET | `/api/v1/visits/[id]` | `/ext/api/v2/scheduler/visits/{id}` | Visit detail |
| GET | `/api/v1/visits/[id]/offers` | `/ext/api/v2/scheduler/visits/{id}/offers` | List visit offers |
| POST | `/api/v1/visits/[id]/offers` | `/ext/api/v2/scheduler/visits/{id}/offers` | Create offer (assign caregiver) |

Server-side client: `src/lib/alayacare-client.ts` — `alayaFetch<T>()` with Basic auth via `ALAYACARE_PUBLIC_KEY` / `ALAYACARE_PRIVATE_KEY` env vars. Base URL defaults to `https://mock-alaya.vercel.app`.

### Scoring & Reasoning Routes

| Method | Route | Purpose |
|---|---|---|
| POST | `/api/v1/visits/[id]/match` | Run scoring engine → return `MatchResult` with ranked candidates |
| POST | `/api/v1/visits/[id]/recommend` | Run scoring → LLM reasoning → return `LLMRecommendation` |
| POST | `/api/v1/availability` | Combined `client_id` + `date` → scored caregivers |

### Roster Management Routes

All follow the standard layered pattern with UoW.

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/v1/roster/tasks` | List roster tasks (filterable by status) |
| POST | `/api/v1/roster/tasks` | Create roster task (manual trigger) |
| GET | `/api/v1/roster/tasks/[id]` | Task detail with full context |
| PATCH | `/api/v1/roster/tasks/[id]` | Update task (accept, assign, defer, cancel) |
| GET | `/api/v1/roster/summary` | Task counts grouped by status |
| GET | `/api/v1/roster/escalations` | Escalated tasks queue |
| GET | `/api/v1/roster/audit` | Searchable audit log (filter by task, action, date range) |
| GET | `/api/v1/roster/analytics` | Daily metrics + totals (fill rate, time-to-fill, escalation rate) |
| POST | `/api/v1/roster/process-events` | Trigger workflow orchestration for pending tasks |

### Chat Route

| Method | Route | Purpose |
|---|---|---|
| POST | `/api/v1/chat/stream` | SSE chat stream with tool use (4 read + 3 write tools) |

The chat route is exempt from single-UoW pattern (D4) — it orchestrates commands across the SSE boundary using `createSSEResponse()` from `src/lib/sse.ts`.

**Read tools** (execute immediately):
- `get_task_status` — roster task details by ID
- `query_metrics` — fill rate, escalation rate, avg time-to-fill (configurable days)
- `list_recent_tasks` — recent tasks with optional status filter
- `count_tasks_by_status` — summary counts grouped by status

**Write tools** (require user confirmation via SSE `confirmation_required` event):
- `create_roster_task` — create task for a visit (visit_id, urgency)
- `assign_caregiver` — manually assign caregiver to task (optimistic locking via `version`)
- `cancel_task` — cancel active task with reason (optimistic locking via `version`)

### User Management Routes

| Method | Route | Handler |
|---|---|---|
| GET | `/api/v1/user` | `get-profile` (query) |
| PATCH | `/api/v1/user` | `update-profile` (command) |
| DELETE | `/api/v1/user/account` | `delete-account` (command) |
| GET | `/api/v1/user/sessions` | `list-sessions` (query) |
| POST | `/api/v1/user/sessions` | `create-session` (command) |
| PATCH | `/api/v1/user/sessions/[id]` | `manage-session` heartbeat (command) |
| DELETE | `/api/v1/user/sessions/[id]` | end/revoke session (command) |
| GET | `/api/v1/user/devices` | `list-devices` (query) |
| DELETE | `/api/v1/user/devices/[id]` | `remove-device` (command) |
| GET | `/api/v1/user/login-history` | `get-login-history` (query) |

### Webhook Routes

| Method | Route | Auth | Purpose |
|---|---|---|---|
| POST | `/api/v1/webhooks/alayacare` | M2M (shared secret) | AlayaCare event receiver → dispatch to handler |
| POST | `/api/v1/webhooks/sms` | M2M | Inbound SMS response webhook (Twilio stub) |
| POST | `/api/v1/webhooks/email` | M2M | Inbound email response webhook (SES stub) |

### Dev/Testing Routes

| Method | Route | Purpose |
|---|---|---|
| POST | `/api/v1/dev/simulate-response` | PoC 2 evaluation runner (simulate caregiver responses) |

---

## AlayaCare Integration (mock-alaya)

### API Client

- **Module:** `src/lib/alayacare-client.ts`
- **Function:** `alayaFetch<T>(path, options?)` — makes authenticated requests to mock-alaya
- **Auth:** HTTP Basic auth via `ALAYACARE_PUBLIC_KEY` / `ALAYACARE_PRIVATE_KEY` env vars (fails fast if missing)
- **Base URL:** `${ALAYACARE_API_URL}/ext/api/v2` (defaults to `https://mock-alaya.vercel.app`)
- **Shared type:** `AlayaPaginatedResponse<T>` — `{ count, page, total_pages, items: T[] }`
- **Caching:** `cache: "no-store"` — always fresh

### Data Entities in mock-alaya

| Entity | API Path | Used By |
|---|---|---|
| Clients (care recipients) | `/patients/clients` | Proxy route, scoring (coordinates, care needs) |
| Employees (caregivers) | `/employees/employees` | Proxy route, scoring (coordinates, status) |
| Employee Skills | `/employees/employees/{id}/skills` | Scoring (skills match dimension) |
| Skills Reference | `/employees/skills` | Skills reference UI |
| Visits | `/scheduler/visits` | Proxy route, scoring (shift details), roster triggers |
| Visit Offers | `/scheduler/visits/{id}/offers` | Scoring (acceptance history), assignment write-back |

### Integration Patterns

- **Proxy passthrough:** UI routes forward to mock-alaya with auth injection — no local persistence
- **Scoring data source:** `computeMatch()` orchestrator fetches visit, client, employees, skills, history, and offers from mock-alaya in parallel batches
- **Write-back:** Assignment creates an offer in mock-alaya via `POST /scheduler/visits/{id}/offers`
- **Webhook source:** mock-alaya sends events to `/api/v1/webhooks/alayacare` (M2M auth)

---

## Event Types & Event Processing

### Webhook Event Processing Pipeline

```
mock-alaya ──webhook──► POST /api/v1/webhooks/alayacare
                              │
                       1. validateWebhookSecret(req)     # timing-safe x-webhook-secret check
                       2. Parse + validate via Zod        # AlayaCareEventSchema
                       3. Idempotency check               # SELECT on workflow_events.event_id
                       4. Record event (received)          # INSERT with unique constraint catch
                       5. dispatch(event, traceId)         # Handler registry lookup + execute
                       6. Update event status              # completed | failed + result/error
```

### Event Schema (`src/lib/alayacare-events/types.ts`)

```typescript
AlayaCareEvent {
  event_id: string (UUID)
  event_type: one of 9 types (see below)
  timestamp: string
  payload: Record<string, unknown>
  metadata: {
    source: "simulation" | "lambda"
    trace_id: string
    scenario?: string
  }
}
```

### Supported Event Types

| Event Type | Handler | Criticality | Action |
|---|---|---|---|
| `visit.vacated` | `handle-visit-vacated` | **Critical** | Run scoring → LLM recommendation → create roster task |
| `visit.created` | `handle-visit-created` | Normal | Log visit, flag if unassigned |
| `visit.updated` | `handle-visit-updated` | Normal | Update task if visit details change |
| `visit.cancelled` | `handle-visit-cancelled` | Normal | Cancel matching roster task |
| `employee.created` | — | Logged only | — |
| `employee.status_changed` | `handle-employee-status-changed` | Normal | Detect resignations, update availability |
| `employee.unavailability.created` | `handle-employee-unavailability` | Normal | Log unavailability period |
| `client.created` | `handle-client-created` | Normal | Log new client |
| `service.created` | — | Logged only | — |

### Event Processing Architecture

- **Auth:** M2M via shared secret in `x-webhook-secret` header — `validateWebhookSecret()` uses `timingSafeEqual` (NOT Supabase user auth)
- **Idempotency:** Two-layer — SELECT check + unique constraint catch on INSERT (handles race conditions)
- **Dispatcher:** Module-level handler registry in `src/lib/alayacare-events/dispatcher.ts` — `registerHandler()` at import time, `dispatch()` at runtime
- **Handler registration:** Side-effect import of `register-handlers.ts` in the webhook route file
- **Storage:** `workflow_events` table — no RLS, no user_id (system data), direct `db` access (no UoW)
- **Env var:** `ALAYACARE_WEBHOOK_SECRET` — required (500 if missing)

### Critical Path: `visit.vacated`

```
visit.vacated event received
  → Fetch visit from AlayaCare
  → Run computeMatch() (scoring engine)
  → buildRecommendationContext() (shared with /recommend route)
  → getRecommendation() (LLM reasoning)
  → Return { matchResult, recommendation } as event result
```

This is the primary trigger for autonomous shift-filling. The `recommendation-context.ts` module is shared between the `visit.vacated` handler and the `/visits/[id]/recommend` API endpoint.

---

## Caregiver Match Scoring Engine (PoC 1)

Pure algorithmic scoring engine that ranks caregivers for a given visit across 5 dimensions. No LLM — deterministic calculations only. The LLM consumes scoring output in the reasoning layer.

**Detailed architecture:** [`docs/scoring-engine-architecture.md`](./scoring-engine-architecture.md)

### Overview

```
POST /api/v1/visits/[id]/match
  → Fetch visit + client + employee pool from AlayaCare (via alayaFetch)
  → Filter: hard constraints (qualifications + schedule conflicts)
  → Score each employee across 5 dimensions (pure functions)
  → Apply configurable weight preset
  → Compute match confidence (distribution-based: high/medium/low)
  → Return ranked candidates with confidence + data quality warnings
```

### Scoring Dimensions

| Dimension | Scorer | Algorithm | Score range |
|---|---|---|---|
| Skills match | `score-skills.ts` | `valid_matched / required_count` with expiry checks | 0–1 |
| Relationship history | `score-relationship.ts` | Logarithmic visit count × recency multiplier | 0–1 |
| Geographic proximity | `score-proximity.ts` | Haversine distance, linear decay (50km max) | 0–1 |
| Workload balance | `score-workload.ts` | Gaussian centred on pool mean, 1.5× overload penalty | 0–1 |
| Acceptance likelihood | `score-acceptance.ts` | `accepted / (accepted + declined)` with exponential decay (30-day half-life), merges AlayaCare offers + DappaAi contact outcomes | 0–1 |

### Weight Presets (`src/services/scoring/weights.ts`)

| Preset | Skills | Relationship | Proximity | Workload | Acceptance | Use Case |
|--------|--------|-------------|-----------|----------|------------|----------|
| `planned` (default) | 0.20 | 0.30 | 0.15 | 0.20 | 0.15 | Planned shifts — continuity + workload balance |
| `urgent` | 0.15 | 0.10 | 0.25 | 0.10 | 0.40 | Urgent shifts — acceptance + proximity |
| `high_value_client` | 0.15 | 0.35 | 0.15 | 0.10 | 0.25 | High-value clients — proven track record |
| `new_client` | 0.25 | 0.05 | 0.20 | 0.25 | 0.25 | New clients — experienced caregivers |
| `efficiency` | 0.15 | 0.10 | 0.30 | 0.30 | 0.15 | Operational efficiency — proximity + workload |

### Key Files

| File | Purpose |
|------|---------|
| `src/services/scoring/types.ts` | `ScoredCandidate`, `DimensionScore`, `WeightConfig`, `MatchResult`, `FetchedVisitDetail`, `FetchedClientDetail` + shared AlayaCare data shapes |
| `src/services/scoring/compute-match.ts` | Orchestrator — bulk fetch → 3-step filter (schedule → skills fetch → skills) → score → rank; carries fetchedVisit/fetchedClient on result |
| `src/services/scoring/score-*.ts` | Pure scoring functions (one per dimension) |
| `src/services/scoring/constraints.ts` | `checkScheduleConflicts()` + `checkSkillQualifications()` + combined `checkHardConstraints()` |
| `src/services/scoring/match-confidence.ts` | Distribution-based confidence computation |
| `src/services/scoring/weights.ts` | 5 weight presets and validation |
| `app/api/v1/visits/[id]/match/route.ts` | Match endpoint |
| `src/hooks/use-match.ts` | TanStack Query hook |

### Design Principles

- **Scorers are pure functions** — receive data, return 0–1. No I/O, no side effects.
- **Orchestrator owns all data fetching** — single place for query optimisation and error handling. Scorers never call `alayaFetch`.
- **Graceful degradation** — missing data produces score 0 + `confidence: "low"` + warning. Never crashes.
- **PoC 2 contract** — `MatchResult` with `DimensionScore.reason` strings feeds directly into LLM prompts.
- **No database required** — all data fetched from AlayaCare API. No local tables for scoring.

---

## LLM Reasoning Layer (PoC 2)

Takes scored caregiver rankings from the scoring engine and applies contextual reasoning, trade-off analysis, and escalation decisions.

### Separation from Scoring

```
Scoring Engine (PoC 1)           LLM Reasoning (PoC 2)
──────────────────────           ────────────────────────
Deterministic numbers            Contextual interpretation
"Skills: 0.9, Proximity: 0.85"  "Sarah is best despite longer commute because
                                  she has 10 prior visits and client prefers continuity"
Always same output               May vary with context
<50ms                            ~1-3s per call
No cost per call                 Token cost per call
```

### LLM Recommendation Type

```typescript
LLMRecommendation {
  primary: {
    employee_id: number
    employee_name: string
    explanation: string              // "Sarah recommended because..."
    confidence: "high" | "medium" | "low"
  }
  escalation: {
    should_escalate: boolean
    reason: string | null
    urgency: "immediate" | "before_shift" | "informational"
  }
  factors_considered: string[]       // e.g. ["Client prefers female caregivers"]
  trade_offs: string[]               // e.g. ["Higher skilled but further away"]
  model: string
  usage: { inputTokens, outputTokens }
}
```

### Prompt Architecture

The LLM receives a structured prompt with three sections:
1. **System prompt** — role definition, output format (JSON), escalation criteria
2. **Context** — visit details, client info, urgency, data quality warnings
3. **Scored candidates** — top N from scoring engine with dimension breakdowns and human-readable reason strings

### Shared Context Builder

`src/services/recommendation-context.ts` — `buildRecommendationContext(visitId, matchResult, urgency, taskHistory?)` is used by both:
- `POST /api/v1/visits/[id]/recommend` endpoint
- `visit.vacated` webhook handler

This ensures consistent context formatting across interactive and automated paths.

### Key Files

| File | Purpose |
|------|---------|
| `src/services/reasoning/types.ts` | `LLMRecommendation`, `VisitContext`, `ClientContext` |
| `src/services/reasoning/prompts.ts` | System prompt, `buildReasoningPrompt()` context formatter |
| `src/services/reasoning/reasoning-service.ts` | `getRecommendation()` — prompt → Bedrock → parse → validate |
| `src/services/reasoning/parse-response.ts` | Zod-validated JSON parsing with markdown fence stripping |
| `src/services/reasoning/scenario-baselines.ts` | 32 human decision baselines for evaluation |
| `src/services/reasoning/evaluation/` | Escalation evaluation framework (confusion matrix, metrics, reports) |
| `src/services/recommendation-context.ts` | Shared visit+client context builder |

---

## Autonomous Rostering (Phase 1)

End-to-end autonomous shift filling: workflow orchestration, LLM reasoning, multi-channel communication, and human-in-the-loop oversight.

**Detailed architecture:** [`docs/phase1-rostering-architecture.md`](./phase1-rostering-architecture.md)

### Overview

```
Trigger (webhook / chat / manual)
  → Workflow Orchestrator (state machine per task)
    → Data Validation (visit + employee pool checks)
    → Scoring Engine (5-dimension ranking via AlayaCare data)
    → LLM Reasoning (contextual interpretation + escalation decision)
    → Communication Dispatch (SMS / email stubs)
    → Response Monitoring (accept / decline / timeout → cascade)
    → Assignment (write-back to AlayaCare) or Escalation (human queue)
    → Audit Logging (every action with reasoning)
```

### State Machine

```
DETECTED → GATHERING → SCORING → REASONING → CONTACTING → ACCEPTED → ASSIGNED → COMPLETED
                                      │              │
                                      ▼              ▼
                                 ESCALATED      CASCADING ──► (loop to CONTACTING or ESCALATED)
                                                     │
                                                CANCELLED
```

Full status set: `detected | gathering | scoring | reasoning | contacting | cascading | accepted | assigned | escalated | completed | cancelled`

Terminal states: `assigned`, `escalated`, `completed`, `cancelled`

### Orchestrator Design (`src/services/rostering/orchestrator.ts`)

Three-phase pipeline per state transition:

```
Phase 1: Read (inside UoW)
  → Get current task state

Phase 2: External calls (outside UoW — no DB connection held)
  → computeMatch(), getRecommendation(), send SMS, etc.

Phase 3: Persist (inside UoW with optimistic lock)
  → Re-read fresh task, verify version matches
  → Update task state + advance status
```

The orchestrator is an **async pipeline**, not a long-running process. Each state transition is a discrete function call. State is persisted to the database between steps; webhooks/polls trigger advancement.

### Urgency Classification

| Factor | Planned | Urgent |
|--------|---------|--------|
| Time to shift | ≥4 hours | <4 hours |
| Weight preset | `planned` (continuity) | `urgent` (acceptance + proximity) |
| Cascade strategy | Sequential | Parallel (top 5 simultaneously) |
| Expiry window | 2 hours | 20 minutes |
| Escalation threshold | After top 10 contacts exhausted | 15 minutes with no response |

### Cascade Engine (`src/services/rostering/cascade-engine.ts`)

- **Sequential** (planned shifts): Contact #1 → wait → Contact #2 → wait → ...
- **Parallel** (urgent shifts): Top 5 contacted simultaneously. First acceptance wins; others cancelled.
- **Escalation triggers:** Time-based (configurable), contact-count-based, LLM-recommended

### Communication Layer (`src/services/communication/`)

Provider-abstracted communication with mock stubs (Twilio/SES placeholders for production cutover):

| File | Purpose |
|------|---------|
| `types.ts` | `CommunicationProvider` interface |
| `dispatcher.ts` | Send + retry logic |
| `sms-provider.ts` | Mock SMS (Twilio stub) |
| `email-provider.ts` | Mock email (SES stub) |
| `templates.ts` | Message templates (shift offer, confirmation, cancellation) |

### Chat Tools (Conversational Interface)

The chat interface (`/chat` page → `/api/v1/chat/stream`) provides natural language access to rostering operations via LLM tool use.

**Architecture:** Bedrock Haiku 4.5 receives tool definitions as part of the system prompt. Tool calls are detected in the streamed response (` ```tool_call {json} ``` ` format), executed server-side, and results streamed back for the LLM to summarise.

**Write tool confirmation flow:**
```
User: "Create a task for visit 123"
  → LLM streams response with tool call
  → SSE sends confirmation_required event (tool name + args)
  → User confirms in UI
  → Second POST with confirmed_action → execute in UoW → stream result
```

Optimistic locking on write tools: read `version` column, update with `where(version = expected)`, return error on concurrent modification.

### Audit & Analytics

- **Audit trail:** `appendAudit()` in `audit-service.ts` — append-only log in `roster_audit_log` table. Records all state transitions, chat write actions, escalation decisions with reasoning.
- **Daily metrics:** `roster_daily_metrics` table materialised by `metrics-service.ts` — tasks created, filled autonomous, escalated, avg time-to-fill, first-contact acceptance rate.
- **Outcome tracking:** `extractOutcome()` in `outcome-tracker.ts` — structured learning data from resolved tasks.
- **Pattern recognition:** `analysePatterns()` detects `always_declines`, `never_accepts`, `client_churn`, high escalation rate.

### Key Rostering Files

| File | Purpose |
|------|---------|
| `src/services/rostering/types.ts` | `RosterTaskStatus`, `ContactAttempt`, `CascadeStrategy`, urgency enums |
| `src/services/rostering/orchestrator.ts` | State machine: `advanceTask()` → read → external → persist |
| `src/services/rostering/roster-task-service.ts` | CRUD for `roster_tasks` table |
| `src/services/rostering/cascade-engine.ts` | Sequential + parallel cascade strategies, escalation checks |
| `src/services/rostering/trigger-detector.ts` | Escalation triggers (time, contacts, LLM recommendation) |
| `src/services/rostering/urgency-classifier.ts` | Planned vs urgent classification |
| `src/services/rostering/data-validator.ts` | Pre-scoring validation (visit, employee pool) |
| `src/services/rostering/chat-tools.ts` | Tool definitions + execution (read: 4, write: 3) |
| `src/services/rostering/audit-service.ts` | `appendAudit()` — append-only audit log |
| `src/services/rostering/metrics-service.ts` | Daily metrics materialisation |
| `src/services/rostering/outcome-tracker.ts` | Task outcome extraction for learning |
| `src/services/rostering/pattern-recognition.ts` | Pattern analysis across completed tasks |

---

## LLM Integration

- **Model:** Claude Haiku 4.5 via AWS Bedrock (`au.anthropic.claude-haiku-4-5-20251001-v1:0`)
- **Region:** `ap-southeast-2`
- **Client:** `src/lib/llm/` — Bedrock Converse API (`generateText` + `streamChat`)
- **Rostering reasoning:** Receives `MatchResult` from scoring engine, outputs `LLMRecommendation` with explanation, confidence, escalation decision, and trade-off analysis. Temperature: 0.3 (consistency).
- **Conversational chat:** Natural language queries + tool execution (get task status, assign caregiver, etc.). Temperature: 0.7 (flexibility).
- **Evaluation framework:** 32 scenario baselines in `src/services/reasoning/scenario-baselines.ts`. Evaluation runner at `scripts/run-evaluation.ts` with confusion matrix metrics (TP/TN/FP/FN, accuracy, sensitivity, precision).

---

## Database Schema

All tables use UUID primary keys and timezone-aware timestamps. Defined in `src/db/schema.ts`.

### Core Tables

| Table | Key Columns | Notes |
|---|---|---|
| `users` | `id` (PK), `supabase_id` (unique), `email` (unique), `name`, `status`, `status_reason` | Status: active, suspended, soft_deleted |
| `projects` | `id`, `user_id` → users, `name`, `description`, `status` | Legacy (starter template) |
| `meetings` | `id`, `user_id` → users, `title`, `start_time`, `end_time`, `attendees` (jsonb) | Legacy (starter template) |
| `chat_conversations` | `id`, `user_id` → users, `title` | Chat session tracking |
| `chat_messages` | `id`, `conversation_id` (cascade), `user_id`, `role`, `content` | role: user/assistant |

### User Management Tables

| Table | Key Columns | Notes |
|---|---|---|
| `user_sessions` | `id`, `user_id` (cascade), `device_id`, `status`, `expires_at`, `ended_reason` | Custom session tracking |
| `user_devices` | `id`, `user_id` (cascade), `device_fingerprint`, `device_type`, `browser` | Unique on (user_id, fingerprint) |
| `user_status_history` | `id`, `user_id`, `from_status`, `to_status`, `reason`, `changed_by` | Audit trail |

### System Tables

| Table | Key Columns | Notes |
|---|---|---|
| `workflow_events` | `id`, `event_id` (unique), `event_type`, `source`, `status`, `payload` (jsonb), `result` (jsonb), `trace_id`, `error` | No RLS — system data, no user_id. Migration 011. |

### Rostering Tables (Migration 012)

| Table | Key Columns | Notes |
|---|---|---|
| `roster_tasks` | `id`, `user_id`, `visit_id`, `client_id`, `status`, `urgency`, `version` (optimistic lock), `match_result` (jsonb), `llm_recommendation` (jsonb), `contacts` (jsonb), `cascade_strategy`, `assigned_employee_id`, `source_event_id` | Workflow state. RLS via `user_id = auth.uid()`. |
| `roster_audit_log` | `id`, `task_id` (cascade), `user_id`, `action`, `actor`, `details` (jsonb), `reasoning` | Append-only. RLS via `user_id = auth.uid()`. |
| `roster_daily_metrics` | `id`, `user_id`, `date`, `tasks_created`, `tasks_filled_autonomous`, `tasks_escalated`, `avg_time_to_fill_ms`, `first_contact_acceptance_rate` | Unique on (user_id, date). RLS via `user_id = auth.uid()`. |

### Two-ID System

The app uses two distinct UUIDs per user:

| ID | Column | Code Name | Purpose |
|---|---|---|---|
| Internal UUID | `users.id` | `principalId` | All foreign keys, RLS policies, tenant isolation |
| Supabase Auth UUID | `users.supabase_id` | `supabaseId` | Auth provider identity mapping only |

**Flow:** Supabase Auth returns a `supabase_id` → `requireAuthContext()` / `getOrCreateUser()` maps it to the internal `users.id` → that becomes `ctx.principalId` → UoW sets `request.jwt.claims.sub = principalId` → `auth.uid()` returns the internal UUID → RLS policies match against it.

### Conventions

- Boolean columns use `integer` (not `boolean`) — driver compatibility
- All FKs reference `users.id` (internal UUID), never `supabase_id`
- JSONB columns for flexible data: `match_result`, `llm_recommendation`, `contacts`, `details` — schema evolves without migrations during rapid iteration

---

## Services

| Service | Responsibility |
|---|---|
| `user-service.ts` | Profile CRUD (get, update) |
| `user-lifecycle-service.ts` | Status machine (active ↔ suspended, active → soft_deleted), login tracking |
| `session-service.ts` | Session/device CRUD, heartbeat, login history |
| `project-service.ts` | Project CRUD (legacy) |
| `meeting-service.ts` | Meeting CRUD (legacy) |
| `chat-service.ts` | Conversation/message CRUD |
| `recommendation-context.ts` | Shared visit+client context builder for scoring → reasoning pipeline |
| `scoring/` | 5-dimension caregiver match scoring — see [Scoring Engine Architecture](./scoring-engine-architecture.md) |
| `reasoning/` | LLM reasoning: prompt building, response parsing, evaluation — see above |
| `rostering/` | Workflow orchestrator, cascade/escalation engines, audit, metrics, chat tools — see [Phase 1 Architecture](./phase1-rostering-architecture.md) |
| `communication/` | Multi-channel dispatch with provider abstraction (SMS/email mock stubs) |

All services follow the pattern: `(tx: TransactionClient, userId: string, ...) → result`

**Exceptions:**
- The scoring service does not use UoW — reads from AlayaCare API via `alayaFetch`, not from the local database.
- The rostering orchestrator uses UoW for task persistence but calls `alayaFetch` (scoring data) and external providers (SMS, email) **outside** the transaction boundary (three-phase pipeline).
- The reasoning service calls AWS Bedrock (external LLM API) and does not use transactions.

---

## Client State Management

### Provider Hierarchy

```
AuthProvider                    # Supabase auth state
  └── Providers                 # QueryClient + ThemeProvider
        └── App Layout          # Sidebar, header, breadcrumbs
              └── Pages         # Route components
```

### TanStack Query Hooks (`src/hooks/`)

| Hook | Features |
|---|---|
| `use-alaya-clients.ts` | AlayaCare client search/filter |
| `use-employees.ts` | Employee list + employee skills (conditional) |
| `use-skills.ts` | Skills reference data |
| `use-visits.ts` | Visits (filter by status/date/client/employee), offers, create visit, create offer |
| `use-visit.ts` | Single visit detail (GET by ID) |
| `use-match.ts` | Scoring engine match results (POST mutation) |
| `use-recommendation.ts` | LLM recommendation (scoring → reasoning pipeline) |
| `use-roster-tasks.ts` | Roster task list, create, update |
| `use-roster-analytics.ts` | Roster analytics (daily metrics + totals) |
| `use-roster-audit.ts` | Roster audit log search |
| `use-escalations.ts` | Escalated tasks list |
| `use-debounce.ts` | `useDebouncedValue(value, delayMs)` — generic debounce utility |
| `use-user.ts` | Profile get/update, account deletion |
| `use-sessions.ts` | Sessions, devices, login history (lazy-loaded) |

All hooks use `apiFetch()` from `src/lib/api-client.ts` — never bare `fetch()`. The wrapper provides:
1. **Base URL injection** — for mobile clients (unused on web)
2. **Global auth headers** — Bearer tokens for non-cookie clients (unused on web)
3. **403 interception** — detects `ACCOUNT_SUSPENDED` / `ACCOUNT_DELETED` and dispatches `account-status-error` events

---

## Testing

- **Framework:** Vitest 4, Node environment
- **Config:** `vitest.config.ts` — loads `.env.local`, 30s timeouts, no file parallelism
- **Run:** `bun run test` (not `bun test` — doesn't load vitest config env)
- **Coverage:** 554 tests across 65 files
  - **Unit tests:** error handling, handler validation, auth errors, logger, scoring engine (9 files), hooks, visit-status, fixtures, reasoning layer (4 files), validate-webhook, dispatcher, webhook-handlers, rostering services (outcome-tracker, context-enrichment, communication templates)
  - **Integration tests:** user lifecycle, tenant context, session CRUD, match endpoint, availability endpoint, assignment workflow, 32 scoring scenarios, comparison report, alayacare-route, handle-visit-vacated, roster API routes
  - **E2E workflow tests:** 10 autonomous rostering scenarios
  - **Performance benchmarks:** 5 tests (scoring, confidence, cascade, outcomes, concurrency)
  - **Evaluation tests:** compute-metrics (11), build-report (5), run-scenario (5)
- **Test fixtures:** `src/test/fixtures/` — mock-employees (150), mock-skills, mock-visits (55), mock-offers (~800)
- **Helpers:** `src/test/helpers.ts` — `createTestUser()`, `createTestProject()`, `withTestTenantContext()`, `cleanupTestData()`

---

## Migrations

| Migration | Description | Notes |
|---|---|---|
| 001 | Initial schema (users, projects) | |
| 002 | Chat tables | |
| 003 | User management (sessions, devices, status history) | |
| 004 | Meetings | |
| 005 | Enable RLS on all tables | |
| 006 | RLS policies using `current_tenant_id()` | Superseded by 009 |
| 007 | Defense in depth | |
| 008 | Rename `cognito_id` → `supabase_id` | Cognito → Supabase migration |
| 009 | RLS policies using `auth.uid()` | Drops old `current_tenant_id()` function |
| 010 | `mayfly_app` role (non-BYPASSRLS) | Must run manually in Supabase SQL Editor |
| 011 | Workflow events table | No RLS — system data |
| 012 | Roster tables (roster_tasks, roster_audit_log, roster_daily_metrics) | RLS policies on all three |

---

## Design Decisions

| ID | Decision | Rationale |
|---|---|---|
| D1 | Supabase Realtime via server-side service role key | Not client-side RLS (yet) |
| D3 | Bootstrap context (`getOrCreateUser`) runs outside UoW | No tenant ID exists yet at bootstrap time |
| D4 | Chat stream route exempt from single-UoW pattern | Orchestrates 2 commands across SSE boundary |
| DA1 | Batch user migration from Cognito with password reset | Cognito doesn't export password hashes |
| DA2 | `@supabase/ssr` for automatic cookie management | Replaces manual cookie sync |
| DA3 | `auth.uid()` RLS strategy (verified, policies active) | UoW sets `request.jwt.claims.sub` = `principalId` (internal UUID) |
| DA4 | Keep custom session/device tracking tables | Supabase Auth doesn't expose device fingerprinting or session listing |
| DA6 | Supabase client for auth, Drizzle for data | Avoids rewriting services to use Supabase query builder |
| S1 | Scorers are pure functions | No I/O, no side effects. Trivially testable. |
| S2 | Orchestrator owns all data fetching | Single place to optimise queries and handle AlayaCare API errors |
| S3 | Scores normalised to 0–1 | Composable via weighted sum. Overall score is naturally 0–1. |
| S4 | Graceful degradation for missing data | Null coordinates → score 0 + low confidence + warning. Never crashes. |
| P1 | Async pipeline, not long-running process | Next.js serverless constraints; state persisted to DB between steps |
| P2 | LLM for reasoning, not scoring | Scoring is deterministic math; LLM adds contextual interpretation |
| P3 | Provider-abstracted communication | SMS/email behind interfaces; swappable without workflow changes |
| P4 | Append-only audit log | Separate table; never modified; supports compliance |
| P5 | JSONB for flexible data | match_result, llm_recommendation, contacts evolve without migrations |
| P6 | Urgency drives strategy | Single classification determines weight preset, cascade mode, expiry, escalation threshold |
| P8 | Local DB for task state, AlayaCare for entity data | RosterTask lifecycle is ours; caregiver/client/visit data stays in AlayaCare (source of truth) |

---

## Key Gotchas

1. **RLS not enforced yet** — `postgres` role has BYPASSRLS. Tenant isolation relies on service-layer WHERE clauses. UoW sets `request.jwt.claims` so `auth.uid()` works — RLS policies are in place and will enforce once connected as `mayfly_app` role (migration 010).
2. **`SET LOCAL` caveat** — Does not support parameterized queries. Uses `sql.raw()` with manual escaping.
3. **Zod v4** — `ZodError` doesn't extend `Error`. Duck-type with `"issues" in err`.
4. **`next lint` broken** — Use `npx tsc --noEmit` for validation.
5. **Migration runner** — Splits on `;`. Avoid semicolons in SQL comments and `$$` dollar-quoted blocks.
6. **`apiFetch` vs bare `fetch`** — Auth provider uses bare `fetch` during bootstrap; all hooks use `apiFetch`.
7. **Three-phase orchestrator** — External calls (scoring, LLM, SMS) run outside UoW to avoid holding DB connections. Optimistic locking via `version` column handles TOCTOU gaps.
8. **Chat write confirmation** — `confirmed_action` must be validated against `isWriteTool()` before execution to prevent arbitrary tool execution.
