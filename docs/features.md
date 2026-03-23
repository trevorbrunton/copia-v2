# DappaAi AI — Feature Guide

Current feature inventory for the DappaAi AI application. Updated 2026-03-15.

---

## 1. Authentication & User Management

### 1.1 Supabase Auth
- **Email/password sign-up and sign-in** with OTP email verification (6-digit code)
- **Password reset** via email link → callback → new password form
- **Cookie-based sessions** via `@supabase/ssr` (web) + Bearer token support (mobile-ready)
- **Middleware route protection** — unauthenticated users redirected to `/sign-in`

### 1.2 User Lifecycle
- **Status machine:** `active` → `suspended` ↔ `active`, `active` → `soft_deleted`
- **Account deletion:** Self-service soft delete with status guard
- **Account status overlay:** Force-sign-out UI for suspended/deleted accounts
- **Status history audit trail** in `user_status_history` table

### 1.3 Session & Device Management
- **Custom session tracking** — `user_sessions` table with 30-day TTL
- **Device fingerprinting** — hash-based detection stored in `user_devices` table
- **Session heartbeat** — PATCH every 15 minutes to maintain session liveness
- **Session revocation** — revoke individual sessions or all except current
- **Device removal** — cascades to associated sessions
- **Login history** — paginated, lazy-loaded when Security tab opens

### 1.4 Settings UI
- **Profile tab** — edit name and email
- **Security tab** — password change, active sessions, device list, login history
- **Account tab** — account deletion with confirmation
- **Direct tab linking** — `?tab=profile|security|account` query param support

---

## 2. AlayaCare Integration (PoC)

### 2.1 API Client
- **Server-side proxy** — `src/lib/alayacare-client.ts` with `alayaFetch<T>()` helper
- **Basic auth** — `ALAYACARE_PUBLIC_KEY` / `ALAYACARE_PRIVATE_KEY` (fails fast if missing)
- **Shared pagination type** — `AlayaPaginatedResponse<T>` used by all hooks
- **TTL cache** — `src/lib/alayacare-cache.ts` with 30s TTL + stampede prevention (concurrent callers share one in-flight fetch)
- **Cached employee roster** — `getEmployeeRoster()` bulk-fetches active employees + all skills, cached for 30s — eliminates N+1 per-employee skills API calls in burst scoring
- **Cache invalidation** — employee lifecycle webhook handlers (`status_changed`, `unavailability`) invalidate `CACHE_KEY_EMPLOYEE_ROSTER`

### 2.2 Data Entities

| Entity | Read | Write | API Endpoint |
|--------|------|-------|-------------|
| Clients (care recipients) | GET list with search/status filter | — | `/patients/clients` |
| Employees (caregivers) | GET list with search/status filter | — | `/employees/employees` |
| Employee Skills | GET by employee ID | — | `/employees/employees/{id}/skills` |
| Skills (reference data) | GET full list | — | `/employees/skills` |
| Visits (scheduled shifts) | GET with status/date/client/employee filter | POST create | `/scheduler/visits` |
| Visit Offers | GET by visit ID | POST create | `/scheduler/visits/{id}/offers` |

### 2.3 API Routes
- All routes under `app/api/v1/` with `/api/*` → `/api/v1/*` rewrites
- **Authenticated** — `requireAuthContext(req, traceId)` on every route
- **Error handling** — `handleAppError(err, traceId)` with structured error envelope
- **Proxy pattern** — routes forward to AlayaCare; no UoW/policy/service layer needed

### 2.4 Client Hooks (TanStack Query)
| Hook | Purpose |
|------|---------|
| `useAlayaClients(search?, status?)` | Paginated client search |
| `useEmployees(search?, status?)` | Paginated employee search |
| `useEmployeeSkills(employeeId)` | Skills for a specific employee (conditional) |
| `useSkills()` | All skills reference data |
| `useVisits(options?)` | Visits with flexible filtering (status, dates, client, employee) |
| `useVisitOffers(visitId)` | Offers for a specific visit (conditional) |
| `useCreateVisit()` | Mutation — create visit + cache invalidation |
| `useCreateOffer()` | Mutation — create offer + targeted cache invalidation |

---

## 3. Dashboard

- **4-metric summary** — Total Visits, Unfilled (vacant) Visits, Employees, Clients
- **4 rostering metrics** — Active Tasks, Escalations, Filled Today, Avg Time to Fill
- **Error state handling** — shows "Unable to load" per card when API unavailable
- **Navigation links** — each card links to its detail page
- **Unfilled visits highlight** — orange styling to draw attention
- **Reset App Data button** — confirmation dialog, truncates rostering/webhook tables (temporary — for use after mock-alaya reseed)

---

## 4. Browse Pages

### 4.1 Clients Page (`/clients`)
- **Card grid** — name, status badge, email, phone, location, care needs
- **Search** — debounced (300ms) text search forwarded to AlayaCare API
- **Loading/error/empty states** — all handled gracefully

### 4.2 Employees Page (`/employees`)
- **Card grid** — name, designation/job title, status badge, email, phone, location
- **Search** — debounced (300ms) text search
- **Nested demographics** — handles AlayaCare's nested employee data structure

### 4.3 Visits Page (`/visits`)
- **Card grid** — status badge (color-coded), datetime, time range, client/employee IDs, service instructions
- **Status filter** — debounced text input for filtering by visit status
- **10 status colors** — scheduled, vacant, completed, cancelled, clocked, offered, late, missed, approved, on_hold
- **Dark mode support** — Tailwind `dark:` variants in status color definitions

---

## 5. Navigation

### 5.1 Sidebar
- **App sidebar** — Dashboard, Visits, Employees, Clients, Settings
- **Active state** — highlights current route using `pathname.startsWith()`
- **Semantic icons** — CalendarClock (visits), Users (employees), UserRound (clients)

### 5.2 Breadcrumbs
- **Auto-generated** — from URL path segments with `ROUTE_LABELS` mapping
- **UUID detection** — regex-based for detail page labels
- **Dynamic labels** — `useBreadcrumbLabel(name)` for entity name display

### 5.3 User Button
- **Header dropdown** — avatar with profile/settings links + sign out

---

## 6. Infrastructure & Patterns

### 6.1 Layered Architecture
- **Transport** → **Handler** → **Service** → **Database** (for internal resources)
- **Transport** → **AlayaCare proxy** (for external AlayaCare data)
- **Composition root** — `makeDeps()` singleton with UoW, ReadOnly, policies

### 6.2 Database
- **Supabase PostgreSQL** via `postgres-js` with Drizzle ORM
- **RLS policies** on all 8 tables using `auth.uid()` (prepared, not yet enforced)
- **Two-ID system** — internal `principalId` UUID + Supabase `supabaseId`
- **10 migrations** — from initial schema through `mayfly_app` role creation

### 6.3 Error Handling
- **AppError hierarchy** — Unauthorized (401), Forbidden (403), NotFound (404), Conflict (409), Validation (400), ExternalService (502)
- **Structured error envelope** — `{ error: { code, message, details?, traceId? } }`
- **Zod v4 support** — duck-typed error detection (`"issues" in err`)

### 6.4 Structured Logging
- **Zero-dependency logger** — JSON in production, readable in development
- **LOG_LEVEL** — `debug | info | warn | error` (default: `info`)
- **Request tracing** — `traceId` threaded through auth context, handlers, error envelopes

### 6.5 Testing
- **Vitest 4** — 581 tests across 67 files
- **Unit tests** — error handling, handler validation, auth errors, logger, 9 scoring engine, hooks, visit-status, fixtures, 4 reasoning layer, validate-webhook, dispatcher, webhook-handlers, alayacare-cache, webhook-debouncer, rostering services (chat-tools, outcome-tracker, pattern-recognition, orchestrator, cascade-engine, etc.)
- **Integration tests** — user lifecycle, RLS enforcement, tenant context, UoW, match endpoint, availability endpoint, assignment workflow, 32 scoring scenarios, comparison report, alayacare-route, handle-visit-vacated, roster API routes
- **E2E workflow tests** — 10 autonomous rostering scenarios (happy path, cascade, escalation, parallel, cancel)
- **Performance benchmarks** — 5 tests (scoring, confidence, cascade, outcomes, concurrency)
- **Evaluation tests** — compute-metrics (11), build-report (5), run-scenario (5)

---

## 7. Scoring Engine (PoC 1 — Sprints 1–3 Complete)

### 7.1 Core Algorithm
- **Weighted Sum Model (WSM)** — 5 dimensions normalised to [0, 1], weighted composite score
- **5 weight presets** — `planned` (default), `urgent`, `high_value_client`, `new_client`, `efficiency`
- **Hard constraint filter** — qualifications (present + not expired) + schedule conflict (interval overlap)
- **Distribution-based match confidence** — high/medium/low based on top score, gap to #2, data completeness

### 7.2 Scoring Dimensions
| Dimension | Algorithm | Confidence Logic |
|-----------|-----------|-----------------|
| Skills match | `valid_matched / required_count` | Low if no requirements defined |
| Relationship history | `ln(count+1)/ln(20)` × recency multiplier (≤7d: 1.0, ≤30d: 0.8, ≤90d: 0.6, >90d: 0.4) | Low for <3 visits, medium 3-9, high 10+ |
| Geographic proximity | Haversine distance, linear decay `max(0, 1 - d/50km)` | Low if coordinates missing |
| Workload balance | Gaussian `exp(-0.5 × z²)` with 1.5× overload penalty | Medium if zero variance |
| Acceptance likelihood | `accepted / (accepted + declined)`, pending ignored | Low <3 offers, medium 3-9, high 10+ |

### 7.3 Orchestrator
- **4 phases** — Bulk Data Fetch (Promise.all) → 3-Step Hard Constraint Filter → Multi-Factor Scoring → Ranking + Confidence
- **Cached employee roster** — employees + skills bulk-fetched once via `AlayaCareCache` (30s TTL with stampede prevention), shared across burst scoring calls
- **3-step constraint filtering** — status filter (active only) → schedule conflicts → skill qualifications
- **Server-side filtering** — `status=active` param on employee list endpoint reduces payload
- **Data passthrough** — `fetchedVisit` + `fetchedClient` carried on `MatchResult` so downstream consumers (e.g., `buildRecommendationContext`) skip redundant API calls
- **Pure function scorers** — no I/O, receive pre-fetched data from orchestrator
- **Data quality warnings** — missing coordinates, no skills on file, no required skills, no client assigned
- **Null client_id handling** — graceful degradation (skips client-dependent fetches, uses empty defaults)
- **63 unit tests** across 9 test files (co-located)

### 7.4 Match API & UI (Sprint 2)
- **`POST /api/v1/visits/[id]/match`** — authenticated endpoint, Zod-validated request body
- **Zod schema** — optional `preset` (5 values) or `weights` (must sum to 1.0) with mutual exclusion refinement, optional `limit` (1–50)
- **`ExternalServiceError`** (502) — centralised in `handleAppError` (auto-detects AlayaCare errors)
- **Invalid JSON handling** — malformed request bodies return 400 ValidationError
- **`useMatch(visitId, options?)`** — TanStack Query hook, POST-based, supports preset/weights/limit/enabled
- **Match results UI** — ranked candidate cards with 5-dimension score bars, confidence badges, data quality warnings, weight preset selector
- **Visit detail page** (`/visits/[id]`) — links from visit list, breadcrumb support for numeric IDs
- **12 endpoint tests** + **6 hook tests** in dedicated test files

### 7.5 Workflows & Edge Cases (Sprint 3)
- **Combined availability query** — `POST /api/v1/availability` accepts `client_id` + `date`, finds visits, scores against first match
- **Assignment workflow** — end-to-end tested: match → select → offer, including 502 rejection and cascade to second candidate
- **Visit detail card** — `VisitDetailCard` with `getShiftStatus()` pure function (injectable `now`), clock_in/clock_out, status badges
- **Shared `STATUS_COLORS`** — extracted to `src/lib/visit-status.ts`, used by visits list page and detail card
- **Mock data fixtures** — `src/test/fixtures/`: 150 employees, 55 visits, ~800 offers, 10 skill types with edge cases
- **Numeric ID validation** — positive integer check on visit ID params (prevents path injection)
- **Edge case documentation** — `docs/poc1-edge-cases.md` (6 data quality, 5 API limitations, 4 error scenarios)
- **Security assessment** — `docs/poc1-security-assessment.md` (auth, traceability, compliance, recommendations)
- **7 availability + 3 assignment workflow + 17 fixture + 6 shift status tests**

### 7.6 Validation & Scenario Testing (Sprint 4 — PoC 1 Complete)
- **32 scoring scenarios** across 6 categories in `src/services/scoring/scenarios.test.ts`:
  - Straightforward (S1–S5): clear winner, tight race, workload differentiator, single candidate, large pool
  - Multi-Qualified (M1–M5): all qualified, partial filter, no skills, expiring-soon, 5-requirement filter
  - Rural/Sparse (R1–R5): all beyond 50km, 2 candidates, proximity differentiates, null coords, missing client coords
  - Preset Comparison (P1–P6): urgent, planned, efficiency, high-value, new-client, custom weights
  - Client Relationship (N1–N5): new client, established, stale vs recent, no client, confidence tiers
  - Hard Constraints (H1–H6): all filtered, schedule conflict, adjacent shifts, expired skill, multiple failures, no requirements
- **Comparison tooling** — `src/services/scoring/comparison-report.test.ts` runs all 32 scenarios, generates `docs/comparison-report.json` with per-scenario dimension breakdowns and expectation validation (32/32 met)
- **Shared test infrastructure** — `src/services/scoring/scenario-test-helpers.ts` (types, location constants, builder functions, mock wiring, scenario definitions) + `scenario-expectations.ts` (expectation data)
- **Workaround documentation** — `docs/poc1-workarounds.md`: 5 manual steps, 6 data gaps, 4 API limitations
- **Production pathway** — `docs/poc1-production-pathway.md`: auth, rate limiting, caching (97% request reduction), monitoring, deployment checklist, ~30 hour effort estimate
- **PoC 1 deliverable** — `docs/poc1-deliverable.md`: formal technical architecture document with integration approach, API capability matrix, scoring engine docs, validation results, limitations, security, Phase 1 estimate (~9–10 sprints)
- **PoC 1 Success Gate: 6/6 criteria PASS**

---

## 8. LLM Reasoning Layer (PoC 2 — Sprints 5–7)

### 8.1 Scenario Development
- **32 human decision baselines** — one per PoC 1 scoring scenario, each with classification, human decision, escalation flag, and rationale
- **4 scenario classifications** — straightforward (14), ambiguous (2), edge_case (9), constraint_violation (7)
- **Escalation baselines** — S4 (single candidate), H1 (zero candidates), R1/R2/R4/R5 (rural/missing data), M3 (no skills), N4 (no client)

### 8.2 Prompt Engineering
- **System prompt** — rostering assistant role, 7 escalation criteria, structured JSON output format
- **Context template** — formats visit details, client info, match result with scored candidates, weight presets
- **Candidate formatting** — rank, name, overall score, 5 dimension breakdowns with confidence and reasons
- **Security note** — prompt injection risk documented for production mitigation

### 8.3 Structured Output Parsing
- **Zod schema validation** — enforces `primary`, `escalation`, `factors_considered`, `trade_offs` structure
- **Markdown fence stripping** — handles LLM responses wrapped in ` ```json ` fences
- **Result type pattern** — `ParseResult` discriminated union (`ok: true | false`) for safe error handling

### 8.4 Reasoning Service
- **`getRecommendation(options)`** — builds prompt → calls `generateText()` → parses/validates → returns `LLMRecommendation`
- **AWS Bedrock Haiku 4.5** — temperature 0.3, maxTokens 1024
- **Token usage tracking** — input/output tokens captured in response metadata
- **56 tests** across 4 test files (parse-response, prompts, reasoning-service, scenario-baselines)

### 8.5 Escalation Evaluation Framework (Sprint 6)
- **Confusion matrix metrics** — `computeEscalationMetrics()` calculates TP/TN/FP/FN, accuracy, sensitivity (recall), false positive rate, precision
- **Classification breakdown** — `computeClassificationBreakdown()` groups escalation accuracy by scenario classification (straightforward, ambiguous, edge_case, constraint_violation)
- **Report builder** — `buildEvaluationReport()` aggregates per-scenario results into comprehensive report with metrics, mismatches, and token usage
- **Recommendation mismatch detection** — identifies cases where LLM recommends no candidate (employee_id=0) but human baseline says assign
- **Scenario runner** — `runScenarioEvaluation()` bridges scoring engine → reasoning service → baseline comparison pipeline
- **CLI evaluation runner** — `scripts/run-evaluation.ts` runs all 32 scenarios through live scoring + LLM, outputs `docs/evaluation-report.json`
  - Supports `--scenario S1` (single scenario) and `--dry-run` (no LLM calls) modes
  - Prints escalation metrics summary with target comparison (sensitivity ≥90%, false positive rate <20%)
- **Shared constants** — `DEFAULT_VISIT_ID`, `DEFAULT_VISIT_START`, `DEFAULT_VISIT_END` in `scenario-test-helpers.ts`
- **21 tests** across 3 test files (compute-metrics: 11, build-report: 5, run-scenario: 5)

### 8.6 Integration & Recommendation API (Sprint 7 — PoC 2 Complete)
- **`POST /api/v1/visits/[id]/recommend`** — end-to-end pipeline: scoring → AlayaCare context fetch → LLM reasoning
- **Chained pipeline** — `computeMatch()` → `alayaFetch()` (visit + client detail) → `getRecommendation()` → structured response
- **Returns** `{ match_result, recommendation }` — both scoring results and LLM recommendation in single response
- **Error handling** — `ExternalServiceError` (502) wraps both `alayaFetch` and LLM failures
- **`useRecommendation(visitId, options?)`** — TanStack Query hook, supports preset/weights/limit/enabled
- **`RecommendationPanel`** — UI component with preset selector, AI recommendation card, confidence badge, escalation status, factors, trade-offs, token usage
- **Visit detail page** — `RecommendationPanel` integrated between visit card and match results
- **PoC 2 deliverable** — `docs/poc2-deliverable.md`: formal technical report with architecture, API, evaluation, test coverage, success gate assessment
- **10 endpoint tests + 4 hook tests** in dedicated test files

---

## 9. Webhook Event Processing (Sprint 8)

### 9.1 Webhook Receiver
- **`POST /api/v1/webhooks/alayacare`** — receives events from mock-alaya or production AlayaCare
- **M2M authentication** — `x-webhook-secret` header with timing-safe comparison (not Supabase user auth)
- **Idempotency** — two-layer: SELECT check for already-processed events + unique constraint catch for race conditions
- **9 event types** — `visit.created`, `visit.updated`, `visit.vacated`, `visit.cancelled`, `employee.created`, `employee.status_changed`, `employee.unavailability.created`, `client.created`, `service.created`

### 9.2 Event Dispatcher
- **Handler registry** — module-level singleton in `src/lib/alayacare-events/dispatcher.ts`
- **Duplicate guard** — throws if handler already registered for event type
- **Side-effect registration** — `register-handlers.ts` imported in route file registers all 5 handlers

### 9.3 Event Handlers
| Handler | Event Type | Behavior |
|---------|-----------|----------|
| `handle-visit-vacated` | `visit.vacated` | **Critical path**: scoring → context fetch → LLM recommendation |
| `handle-visit-created` | `visit.created` | Logs visit, flags unassigned visits |
| `handle-visit-updated` | `visit.updated` | Logs visit update |
| `handle-visit-cancelled` | `visit.cancelled` | Logs visit cancellation |
| `handle-employee-status-changed` | `employee.status_changed` | Detects resignations (status=terminated), invalidates employee roster cache |
| `handle-employee-unavailability` | `employee.unavailability.created` | Logs unavailability, invalidates employee roster cache |
| `handle-client-created` | `client.created` | Logs new client |

### 9.4 Webhook Debouncer
- **Scoring-heavy events** (`visit.vacated`, `visit.created`, `visit.updated`) buffered for ~2s via `WebhookDebouncer`
- **Purpose** — when many events arrive in a burst (e.g. employee quits → 20 visits vacated), the debouncer ensures the AlayaCare cache is warmed once and shared across all events
- **Configurable** — `WEBHOOK_DEBOUNCE_MS` env var (default 2000, set to 0 to disable for tests)
- **Error surfacing** — failed debounced events return 500 (not swallowed)
- **Non-scoring events** — dispatched immediately (no debounce)

### 9.6 Workflow Events Table
- **`workflow_events`** — stores all processed webhook events with status tracking
- **No RLS** — system data, not user data; direct `db` access (no UoW)
- **Status lifecycle** — `received` → `completed` or `failed`
- **Migration 011** — indexes on `event_type`, `status`, `created_at DESC`

### 9.7 Shared Recommendation Context
- **`src/services/recommendation-context.ts`** — `buildRecommendationContext()` helper
- **Used by** — both `/api/v1/visits/[id]/recommend` route and `handle-visit-vacated` handler (eliminates ~55 lines of duplication)

### 9.8 Testing
- **35 tests** across 5 test files:
  - `validate-webhook.test.ts` (4 unit tests)
  - `dispatcher.test.ts` (6 unit tests)
  - `webhook-handlers.test.ts` (6 unit tests — employee status, unavailability, visit created, client created)
  - `alayacare-route.test.ts` (12 integration tests — auth, validation, idempotency, happy path, error handling)
  - `handle-visit-vacated.test.ts` (7 integration tests — scoring args, context, LLM, result shape, validation, errors)

---

## 10. Autonomous Shift Filling (Phase 1 — Sprints P1.1–P1.8 Complete)

### 10.1 Workflow Orchestrator
- **State machine** — 11 states: `detected → gathering → scoring → reasoning → contacting → cascading → accepted → assigned → escalated → completed → cancelled`
- **Orchestrator** — `src/services/rostering/orchestrator.ts` drives tasks through state machine
- **Two-phase webhook → task** — webhook creates `workflow_events` row, then event processor creates `roster_tasks` row
- **Urgency classifier** — `planned` vs `urgent` based on shift start time
- **Data validator** — validates visit/employee data quality before scoring

### 10.2 Communication
- **Provider abstraction** — `CommunicationProvider` interface in `src/services/rostering/communication/`
- **Mock SMS provider** — Twilio stub (production: `TwilioSMSProvider.send()`)
- **Mock email provider** — SES stub (production: `SESEmailProvider.send()`)
- **Message templates** — caregiver contact, escalation notification
- **Inbound SMS webhook** — `/api/v1/webhooks/sms` with Twilio signature validation
- **LLM-parsed responses** — natural language SMS replies parsed for accept/decline intent

### 10.3 Cascade Engine
- **Sequential cascade** — planned shifts: contact ranked candidates one at a time, wait for response/expiry
- **Parallel cascade** — urgent shifts: contact top N simultaneously, first accept wins
- **Expiry handling** — configurable timeout per contact attempt, auto-cascade on expiry
- **Escalation triggers** — time-based (15min urgent, 60min planned), contact-count-based, LLM-recommended

### 10.4 Escalation Console
- **Escalation UI** — coordinator sees escalated tasks with context, scoring results, and LLM recommendation
- **Human actions** — assign caregiver, re-cascade, cancel task
- **AlayaCare write-back** — creates offer in AlayaCare on assignment (via `alayaFetch`)

### 10.5 Audit Trail & Analytics
- **Audit log** — append-only `roster_audit_log` table with all state transitions, actions, and reasoning
- **Audit search** — `GET /api/v1/roster/audit` with task_id, action, date range filters
- **Analytics dashboard** — `GET /api/v1/roster/analytics` with daily metrics + totals
- **Daily metrics materialisation** — `roster_daily_metrics` table updated by `metrics-service.ts`

### 10.6 Conversational Interface
- **4 read tools** — `get_task_status`, `query_metrics`, `list_recent_tasks`, `count_tasks_by_status`
- **3 write tools** — `create_roster_task`, `assign_caregiver`, `cancel_task` (all require user confirmation)
- **Confirmation flow** — LLM proposes action → SSE `confirmation_required` → client confirms → UoW-wrapped execution
- **Audit integration** — all chat write actions logged via `appendAudit()`

### 10.7 Learning & Feedback
- **Outcome tracking** — `extractOutcome()` extracts structured task outcomes for learning systems
- **Pattern recognition** — `analysePatterns()` detects: always_declines, never_accepts, client_churn, high escalation rate
- **Acceptance feedback loop** — `scoreAcceptance()` merges AlayaCare offer history with DappaAi contact outcomes using exponential decay (30-day half-life)

### 10.8 Database Schema (3 tables)
| Table | Purpose |
|-------|---------|
| `roster_tasks` | Task tracking with state machine, contacts JSONB, match/LLM results |
| `roster_audit_log` | Append-only audit trail (action, actor, details JSONB) |
| `roster_daily_metrics` | Materialised daily metrics (tasks created/filled/escalated, avg time-to-fill) |

### 10.9 Testing
- **581 tests** across 67 files
- **10 E2E workflow tests** — happy path, cascade, escalation, parallel, expiry, cancel scenarios
- **5 performance benchmarks** — scoring 150 candidates <100ms, confidence <10ms, cascade <5ms, outcomes <10ms, concurrent <20ms
- **Production readiness checklist** — `docs/plans/production-readiness-checklist.md`

---

## 11. Not Yet Implemented

| Feature | Target Phase | Notes |
|---------|-------------|-------|
| Voice AI | Phase 2 | Future scope |
| Real-time push notifications | Phase 2 | WebSocket/Supabase Realtime |
| Admin dashboard | Phase 2 | Role-based access, team management |

---

## 12. Architecture Migration Plans

### 12.1 Upstash + Xano Architecture (Recommended)
- **Target architecture** — Xano (database + CRUD + auth), Upstash Workflow (durable state machine), Upstash QStash (webhook processing), Upstash Redis (rate limiting + caching), Next.js (scoring engine + LLM reasoning)
- **Design doc** — [`upstash-xano-architecture.md`](./upstash-xano-architecture.md)
- **Key decisions** — Xano owns data, Next.js owns computation, Upstash owns infrastructure
- **Workflow model** — Upstash Workflow `serve()` with `context.run()` durable steps, `context.waitForEvent()` for caregiver SMS responses, `context.sleep()` for durable timeouts
- **Template integration** — CRUD follows mayfly-template-nextjs three-file domain pattern (schema → API → hooks)
- **Idempotency** — documented for all side effects (AlayaCare API, SMS, audit log)
- **Data residency** — workflow journal returns only IDs/metadata, not PII; full data stays in Xano
- **Platform risk** — mitigated by keeping all business logic in portable TypeScript

### 12.2 Alternative Migration Plans (Evaluated)
| Plan | Document | Status |
|------|----------|--------|
| Restate durable workflow | [`plans/restate-migration-plan.md`](./plans/restate-migration-plan.md) | Evaluated — stronger durability but requires separate server |
| XState + PostgreSQL | [`plans/xstate-migration-plan.md`](./plans/xstate-migration-plan.md) | Evaluated — formal FSM but requires external scheduler for timeouts |

---

## 13. Documentation

| Document | Purpose |
|----------|---------|
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | Main system architecture reference |
| [`upstash-xano-architecture.md`](./upstash-xano-architecture.md) | Target architecture: Upstash + Xano + Next.js (state machine, CRUD, engine) |
| [`scoring-engine-architecture.md`](./scoring-engine-architecture.md) | PoC 1 scoring engine design (5-dimension pure algorithmic scoring) |
| [`phase1-rostering-architecture.md`](./phase1-rostering-architecture.md) | Phase 1 autonomous rostering (workflow, LLM reasoning, communication, HITL) |
| [`poc.txt`](./poc.txt) | Original PoC requirements from stakeholders |
| [`poc-traceability.md`](./poc-traceability.md) | Requirements → implementation status mapping (52 requirements) |
| [`plans/poc-delivery-plan.md`](./plans/poc-delivery-plan.md) | End-to-end PoC delivery plan (7 sprints, 5–6 weeks) |
| [`plans/supabase-auth-migration.md`](./plans/supabase-auth-migration.md) | Cognito → Supabase migration plan (COMPLETE) |
| [`plans/phase1-implementation-plan.md`](./plans/phase1-implementation-plan.md) | Phase 1 autonomous shift filling plan (COMPLETE) |
| [`plans/production-readiness-checklist.md`](./plans/production-readiness-checklist.md) | Production go-live checklist (SMS, email, infra, security, monitoring) |
| [`observability-plan.md`](./observability-plan.md) | Monitoring strategy: platform-native (free) vs Datadog APM (paid) |
| [`plans/restate-migration-plan.md`](./plans/restate-migration-plan.md) | Restate migration plan (evaluated alternative) |
| [`plans/xstate-migration-plan.md`](./plans/xstate-migration-plan.md) | XState + PostgreSQL migration plan (evaluated alternative) |
| [`poc1-deliverable.md`](./poc1-deliverable.md) | PoC 1 formal technical architecture document |
| [`poc1-workarounds.md`](./poc1-workarounds.md) | Manual workarounds and API gaps |
| [`poc1-production-pathway.md`](./poc1-production-pathway.md) | PoC → production migration guide |
| [`poc2-deliverable.md`](./poc2-deliverable.md) | PoC 2 formal technical report (LLM reasoning layer) |
| [`comparison-report.json`](./comparison-report.json) | 32-scenario scoring comparison report (machine-readable) |
| [`plans/webhook-event-processing-plan.md`](./plans/webhook-event-processing-plan.md) | Webhook event processing pipeline plan |
