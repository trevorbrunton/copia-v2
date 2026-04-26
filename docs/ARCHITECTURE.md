# Architecture

System architecture for the **Pep Avatar v2** screening demo at `/demo/screen` plus the standard Supabase auth shell at `/dashboard` and `/settings`.

**Companion documents:**
- [INFRASTRUCTURE.md](./INFRASTRUCTURE.md) — external services, environment variables, deployment.
- [PROCESSING-STREAMS.md](./PROCESSING-STREAMS.md) — every concurrent processing stream and when each is active.

---

## What the app does

A live, voice-driven OC Funds screening demo: an investor speaks to **Pep**, an animated Tavus avatar that lip-syncs in a cloned voice. The page exposes three modes that share one Tavus session and one voice-listener pipeline:

- **Screening** — walk the OC questionnaire funnel (six filters reducing the ASX universe of ~1,979 stocks down to a shortlist). Filters can run linearly via the *Next filter →* button, out of sequence by clicking any pending step in the rail, or by voice ("run the profitability filter").
- **Process Q&A** — twelve curated topics drawn from the OC FSC questionnaire (philosophy, style, universe, research, stock selection, portfolio construction, risk management, ESG, corporate governance, transaction costs, tax, team).
- **Fund Q&A** — three OC funds × twenty-one categories of pre-scripted answers (fees, distributions, target market, etc.) read from `data/fund-qa.json`.

All three modes route through the same intent classifier and narration queue. Snapshot-backed (no live market data); deterministic where possible (rule-first matcher), with an Anthropic Haiku fallback for paraphrases.

Beyond the public demo, the app keeps a small Supabase-backed dashboard / settings surface for authenticated users — sessions, devices, login history, profile CRUD. Useful as a foundation if the demo turns into a product, but not exercised in the pitch.

---

## Two surfaces, two architectural shapes

The app intentionally uses **two different patterns** depending on what the route does. This is documented as decision **D2** in the plan.

| Surface | Route prefix | Auth | Pattern |
|---|---|---|---|
| Public Pep demo | `/demo/screen`, `/api/v1/screen/*`, `/api/v1/demo/tavus/*` | None | Inline route handlers — no UoW, no CQRS layer |
| Authenticated dashboard | `/dashboard`, `/settings`, `/api/v1/user/*` | Supabase cookie or Bearer | Layered CQRS — handlers → policies → services → UoW |

The demo path is hot, simple, and stateless — adding the layered CQRS would just be ceremony. The auth path benefits from the layered shape because every write touches an RLS-bounded transaction with `request.jwt.claims` set per-tx.

---

## Stack

- **Next.js 16** App Router, React 19, TypeScript 5 strict
- **Tailwind CSS 4**, **shadcn/ui**, **Radix UI** primitives
- **Bun** package manager
- **Drizzle ORM** + Supabase PostgreSQL (`postgres-js` driver, pgbouncer pooled)
- **Supabase Auth** (email/password) via `@supabase/ssr` (cookie-managed)
- **TanStack Query** for client server-state
- **Tavus CVI** streaming avatar over **Daily.co** WebRTC (`@daily-co/daily-js`)
- **ElevenLabs** STT (`scribe_v1`) + TTS (Tavus persona-side `eleven_turbo_v2_5`)
- **Anthropic** Claude Haiku for intent-classification fallback (raw `fetch` to `api.anthropic.com`, no SDK)

---

## Public demo data flow

```
┌──────────────┐    PCM audio    ┌──────────────────────────┐    ┌─────────────────────┐
│  Microphone  │────────────────▶│ POST /api/v1/screen/     │───▶│  ElevenLabs STT     │
│  (VAD)       │                 │      process             │    │  (scribe_v1)        │
└──────────────┘                 │                          │    └──────────┬──────────┘
                                 │                          │               │ text
                                 │                          │◀──────────────┘
                                 │  rule-first matcher      │
                                 │  → Anthropic Haiku       │───▶┌─────────────────────┐
                                 │    fallback (5s timeout) │    │  Anthropic API      │
                                 │                          │    └──────────┬──────────┘
                                 │  EntityResolver (ticker) │               │ Intent
                                 └────────────┬─────────────┘◀──────────────┘
                                              │ Intent
                                              ▼
                                ┌─────────────────────────────┐
                                │  ScreenState reducer        │
                                │  (client-side)              │
                                └────────┬────────────────────┘
                                         │ filter / fact / fallback
                                         ▼
                ┌────────────────────────────────────────────────────────┐
                │  POST /api/v1/screen/apply-filter                     │
                │  POST /api/v1/screen/stock-fact                       │
                │  POST /api/v1/screen/portfolio-overlap                │
                │       (read snapshot-cache.ts in-process)             │
                └────────────────────────────────────────────────────────┘
                                         │
                                         ▼ narration text
                ┌────────────────────────────────────────────────────────┐
                │  conversation.echo (Daily app-message, modality:text) │
                │   ▼                                                    │
                │  Tavus persona (pipeline_mode=echo,                    │
                │   tts_engine=elevenlabs, external_voice_id=…)          │
                │   ▼                                                    │
                │  ElevenLabs TTS (server-side, voice clone)             │
                │   ▼                                                    │
                │  Replica lip-syncs to audio                            │
                └────────────────────────────────────────────────────────┘
```

### Voice listener

`src/demo/use-voice-listener.ts` runs continuously on the client. Amplitude-based VAD over `AudioContext` + `ScriptProcessorNode`; flushes a PCM buffer to `/api/v1/screen/process` when the user has been silent for `NEXT_PUBLIC_VAD_SILENCE_TIMEOUT_MS` (default 1000 ms). Pauses while Pep is speaking so the avatar's voice doesn't get re-transcribed.

### Process route

`app/api/v1/screen/process/route.ts` accepts both **multipart audio** (PCM blob + sample rate) and **JSON text**. Multipart calls go through `transcribePcm()` (`src/screen/stt.ts` — ElevenLabs `scribe_v1`, 12 s timeout). After transcription, the text is classified:

1. **Rule layer first** — `matchIntentRule()` in `src/screen/intent-rules.ts`. Three ordered passes:
   - `RULES` — navigation, funnel-filter triggers (e.g. "market cap > 50m" → Q1; "run the profitability filter" → Q4), Q7 daily-monitoring, Q8 portfolio overlap.
   - `matchFundInfoRule` — fires only when a fund name is present (e.g. "OC Mid-Cap Fund's fees" → `info_fund_field`).
   - `matchProcessInfoRule` — fires on a process-topic keyword without needing a name gate (e.g. "OC's investment philosophy" → `info_process_field`).
   - `POST_FUND_INFO_RULES` — generic stock-fact catch-alls (`info_stock_field`) and output preferences. Sit last so they don't hijack the more specific intents.

   Zero external calls when a rule hits.
2. **Anthropic Haiku fallback** — `anthropicClassifier()` in `src/screen/screen-matcher.ts`. Constrained-output classification with a Zod schema validating the model's reply. 5 s timeout; on failure or schema mismatch returns `{ kind: "fallback" }`.
3. **Entity resolver** — `EntityResolver` in `src/screen/entity-resolver.ts` resolves company-name fallbacks (e.g. "commonwealth bank" → CBA) for `info_stock_field` intents. Two passes: ticker token (uppercase 2–5 chars matched against the snapshot ticker set) then company name (bigram match on ≥4-char tokens, single-token fallback on ≥6-char tokens with a stop-word list). Cache keyed by snapshot id.

The route is **rate-limited** per IP (30/min, 200/hour) via `src/server/rate-limit.ts`.

### Screening engine

`src/screen/funnel.ts` is the pure filter engine — `applyOneFilter`, `applyQuestionnairePreset`, `applyMethodologyPreset`, plus `STAGE_IDS`, `STAGE_LABELS`, and `FILTER_THRESHOLDS` constants. Each preset is a `FilterId[]` reduced through `applyOneFilter`, so the filter logic has one source of truth.

The Q2 filter (`q2_exclude_top_100`) **excludes** the top 100 by market cap — OC is a small/mid-cap manager and the largest names are intentionally out of scope. The post-Q1 set is sorted desc by mcap and the top 100 are dropped.

The `M*` methodology filters (`m1_mcap_50m` through `m7_exclude_asx_100`) and `applyMethodologyPreset` remain in the engine for the ingest script and snapshot-fixture tests, but no UI surface reaches them — the methodology funnel was replaced by Process Q&A.

`src/screen/state.ts` is a pure reducer over `ScreenState` (`appliedFilters`, `currentStage`, `appliedAt` timestamps).

`src/screen/use-screener.ts` is the React hook that holds `ScreenState`, calls `/api/v1/screen/apply-filter` for each step, and tracks an `applyInFlightRef` so rapid programmatic calls don't race. Filters can be applied in any order; `applyFilter(filterId)` always operates on the current stage's tickers regardless of where that filter sits in the canonical sequence.

### Snapshot cache

`src/screen/snapshot-cache.ts` holds the active ASX snapshot in-process, behind a 60-second TTL with a single-flight in-flight promise so concurrent requests collapse to one DB load. Both `/api/v1/screen/snapshot` and `/api/v1/screen/apply-filter` read from it. The snapshot is loaded as two parallel projections — `SecurityForClient[]` for the wide UI shape and a `Map<ticker, FilterableSecurity>` for O(1) filter input lookups.

`/api/v1/screen/snapshot` also carries `Cache-Control: public, max-age=60, s-maxage=300, stale-while-revalidate=3600`, so Vercel's edge fronts repeat sessions across instances.

### Q&A banks (Process Q&A + Fund Q&A)

Two static JSON banks back the non-screening modes. Both follow the same pattern: a typed loader bundles the JSON via Next's import resolver, narrows it to a TypeScript shape, and runs a **bidirectional drift assertion at module load** so a JSON edit out of step with the TypeScript union fails loudly at boot.

| Bank | JSON | Loader | Shape | Source |
|---|---|---|---|---|
| **Process Q&A** | `data/process-qa.json` | `src/screen/process-qa.ts` | 12 topics × one answer each | `docs/plans/OC_Prem_Dyn_-_FSC_Questionnaire_0625.txt` (FSC §1.1–1.5 + §2.1–2.19) |
| **Fund Q&A** | `data/fund-qa.json` | `src/screen/fund-qa.ts` | 3 funds × 21 categories | OC fund PDS documents in `docs/fund-data/` |

The dispatcher's `info_process_field` and `info_fund_field` cases call the loaders' typed accessors (`getProcessAnswer`, `getProcessTopicLabel`, `getFundAnswer`, `getFundDisplayName`, `getCategoryLabel`) and run the result through narration templates.

The corresponding right-pane panel renders clickable topic / category buttons that bypass `/api/v1/screen/process` entirely — the click already knows the topic + fund, so it dispatches `{ kind: "info_process_field", topic }` (or `{ kind: "info_fund_field", fundId, category }`) directly, saving a round-trip and an STT bill.

### Tavus avatar wiring

`src/demo/use-tavus-avatar.ts` manages the Tavus CVI session:

1. `initAvatar(personaId)` — POST `/api/v1/demo/tavus` to create a conversation; receive a Daily.co room URL; dynamic-import `@daily-co/daily-js`; join the room; capture the replica's video+audio tracks into a `MediaStream`; resolve when ready.
2. `echo(text)` — single Daily app-message with `event_type: "conversation.echo"`, `properties: { modality: "text", text }`. The persona's TTS layer (configured server-side with `tts_engine: "elevenlabs"`) runs the text through ElevenLabs in our cloned voice and the replica lip-syncs.
3. **Speech-end detection** — listens for `conversation.replica.stopped_speaking` to resolve the `echo()` Promise; otherwise a `~55ms/char + 1s` fallback timer fires.
4. **Auto-reconnect** — one-shot reconnect on `participant-left` or post-ready `left-meeting`; guarded by `reconnectAttemptedRef` so a flaky connection can't loop on creating new (billable) sessions.
5. **Cleanup on tab close** — `pagehide` listener + `fetch(..., { keepalive: true })` for `DELETE /api/demo/tavus/<id>`. Plain `fetch` was being aborted by the browser on unload, leaking conversations.

Persona configuration (decision recorded in `docs/TAVUS-PERSONA-SETUP.md`):

```
pipeline_mode:        "echo"
default_replica_id:   r3b040ae8a6c
layers.tts.tts_engine:        "elevenlabs"
layers.tts.external_voice_id: <ElevenLabs voice id>
layers.tts.tts_model_name:    "eleven_turbo_v2_5"
layers.tts.api_key:            <ElevenLabs API key, server-side on Tavus>
```

We tried client-side **Audio Echo** (synthesise audio ourselves and chunk PCM bytes via Daily app-messages); it didn't deliver in our environment — chunks were silently rejected and `started_speaking` never fired. Persona-side ElevenLabs is the working pattern.

### Narration

`src/screen/narration.ts` is a flat collection of `describeX(...)` template builders, one per intent kind plus a few orientation lines (intro, transitions, gating prompts). `describeAppliedFilter` has a compile-time `assertNever` exhaustiveness guard so adding a new `FilterId` without a narration template fails to typecheck.

The dispatcher in `components/screen/screen-page.tsx` calls these helpers and feeds them to `narrate()`, which queues each echo through `narrationQueueRef` (a `Promise<void>` chain) so a rapid second narration doesn't interrupt the in-flight one. Each link in the chain waits `INTER_NARRATION_PAUSE_MS` (1500 ms) after Tavus's `stopped_speaking` event before releasing — the WebRTC audio buffer can trail several hundred ms past that event on long lines.

Behavioural rules baked into the dispatcher:

- The final filter's narration is concatenated with `describeFunnelCompletePrompt()` into a single echo, not two — Tavus's `stopped_speaking` was firing before the audio drained on long final-filter lines.
- `info_stock_field` is **funnel-gated** in screening mode: until all six pending filters have run, it narrates `describeStockFactGatedByFunnel()` instead of opening the stock-fact panel. fund_qa / process_qa modes aren't gated.
- `applyAndNarrate(filterId)` captures `screener.error` before/after the call so it only narrates failure if a *new* error was set, not on dedup early-returns.

---

## Authenticated dashboard data flow

The auth surface follows a Tier-B (Lightweight) layered architecture:

```
Request
  │
  ▼
Route handler (transport)
  • crypto.randomUUID() → traceId
  • requireAuthContext(req, traceId) → { principalId, supabaseId, email, roles, traceId }
  • makeDeps() → { uow, readOnly }
  • call handler → Response.json(...)
  • errors → handleAppError(err, traceId) → { error: { code, message, details, traceId } }
  │
  ▼
Handler (commands/, queries/)
  • policy check (noop today; extension point for RBAC)
  • Zod-validate input
  • run inside UoW (writes) or ReadOnlyExecutor (reads)
  │
  ▼
Service (src/services/)
  • (tx, userId, ...) → pure data access
  • no business logic, no auth guards (they belong in handlers)
  │
  ▼
Drizzle ORM → Supabase PostgreSQL (RLS via auth.uid())
```

### Auth context

`src/server/require-auth-context.ts` resolves auth from either a Supabase cookie (web) or a Bearer token (mobile). It calls `getOrCreateUser()` (`src/lib/auth.ts`) which is the **only** code path that bypasses RLS — a documented exception for bootstrap. After the bootstrap select, status checks reject `suspended` (403 `ACCOUNT_SUSPENDED`) and `soft_deleted` (403 `ACCOUNT_DELETED`) accounts on every request.

The `getOrCreateUser` cache was deliberately removed — it cached `User` rows process-wide and never invalidated, so a `suspendUser` mutation wouldn't surface to subsequent requests until the process restarted. The replacement does one indexed `SELECT WHERE supabase_id = $1` per request — sub-millisecond and correct.

### UoW

`src/server/uow/drizzle-uow.ts` exposes `DrizzleUoW.run(handler, authContext)` which:

1. Begins a Drizzle transaction.
2. Sets `request.jwt.claims` (the JSON the Supabase `auth.uid()` function reads).
3. Hands the transaction client to the handler.
4. Commits on success, rolls back on throw.
5. Logs `uow:start | uow:commit | uow:rollback` at debug level with the `traceId`.

`DrizzleReadOnly` is the analogous read-only wrapper — issues `SET TRANSACTION READ ONLY` so a mis-routed write throws inside the transaction rather than silently committing.

### Errors

`src/server/errors.ts` defines the `AppError` hierarchy:

| Class | Code | Status |
|---|---|---|
| `UnauthorizedError` | `UNAUTHORIZED` | 401 |
| `ForbiddenError` | `FORBIDDEN` (or custom) | 403 |
| `NotFoundError` | `NOT_FOUND` | 404 |
| `ConflictError` | `CONFLICT` | 409 |
| `ValidationError` | `VALIDATION_ERROR` | 400 |
| `ExternalServiceError` | `EXTERNAL_SERVICE_ERROR` | 502 |
| `TooManyRequestsError` | `RATE_LIMITED` | 429 |

`handleAppError(err, traceId)` maps these to a uniform `{ error: { code, message, details, traceId } }` envelope. `TooManyRequestsError` adds a `Retry-After` header. Zod `ZodError` (which doesn't extend `Error` in v4) is detected by structural typing and produces a 400 with the same envelope.

### Logging

`src/lib/logger.ts` is a zero-dep structured logger wrapping `console`. JSON in production, pretty in dev. `LOG_LEVEL` env (`debug | info | warn | error`, default `info`). `traceId` flows through `AuthContext` → handlers → error envelope so a client-reported trace id can be grepped end-to-end.

---

## Rate limiting

`src/server/rate-limit.ts` is an in-memory sliding-window per-key limiter with sweep-on-cap behaviour:

- Each call is checked against multiple windows (e.g. `[{30/min}, {200/hour}]`); the first full window throws `TooManyRequestsError` with a `Retry-After` second hint.
- Buckets store sorted timestamps; the longest-window cutoff prunes stale entries on each call so memory stays bounded.
- A 10 000-bucket cap triggers `sweep()` which drops the half with the oldest `lastSeen` — protects against IP-rotation memory exhaustion.
- Single-process by design — for horizontal scale, swap the bucket store for Redis or use Vercel edge rate limiting.

Wired into:
- `POST /api/v1/screen/process` — 30/min, 200/hour (caps ElevenLabs STT + Anthropic spend)
- `POST /api/v1/demo/tavus` — 5/min, 20/hour (caps Tavus conversation creates, the most expensive per-call)
- `DELETE /api/v1/demo/tavus/[id]` — 30/min, 100/hour

---

## Server startup

`instrumentation.ts` runs once on Node serverless cold start (skipped on edge runtime). It calls `validateEnv()` (`src/server/env-check.ts`), which:

- Logs a structured **error** for missing **required** vars (currently only `DATABASE_URL`) and throws.
- Logs structured **warnings** for missing optional vars (ElevenLabs / Anthropic / Tavus / Supabase) with a one-line "what breaks if this is missing" annotation.

So a missing `TAVUS_API_KEY` on a Vercel deploy lights up at boot with a clear log line, instead of as an opaque 502 on the first user click.

---

## Code structure

```
app/
├── (public)/                      # No auth (landing, sign-in, sign-up, verify, forgot/reset password)
├── (app)/                         # Auth required (dashboard, settings)
├── auth/callback/                 # Supabase auth callback (code exchange)
├── api/v1/                        # Versioned API
│   ├── user/                      # Profile + sessions + devices + login history (auth, layered)
│   ├── demo/tavus/                # Tavus avatar runtime (unauthenticated)
│   └── screen/                    # Pep screening demo API (unauthenticated)
├── demo/screen/                   # Pep demo page
├── layout.tsx                     # Root layout
└── globals.css

components/
├── app-sidebar.tsx + app-layout.tsx + page-breadcrumbs.tsx
├── account-status-handler.tsx     # 403 overlay for suspended/deleted accounts
├── ui/                            # shadcn/ui
├── screen/                        # Pep demo UI (avatar-video, conversation-pane, funnel-rail, stocks-table, …)
└── settings/                      # Settings tabs (profile, security, account, login-history-dialog)

src/
├── auth/                          # Supabase auth module (provider, server, validation, errors)
├── db/                            # Drizzle (schema.ts + screen-schema.ts)
├── demo/                          # use-tavus-avatar.ts, use-voice-listener.ts (shared between demo + future)
├── screen/                        # Screening engine (funnel, intent, matcher, narration, snapshot-cache, …)
├── server/                        # errors, rate-limit, env-check, require-auth-context, make-deps, uow, commands, queries, policies
├── services/                      # user-service, user-lifecycle-service, session-service
├── lib/                           # logger, api-client, api-response, supabase/, auth.ts, device-detection
└── hooks/                         # use-user, use-sessions, use-debounce

scripts/
├── ingest-asx-snapshot.ts         # Idempotent ASX snapshot ingest from JSON fixture
├── create-tavus-echo-persona.ts   # POST /v2/personas with pipeline_mode: "echo"
├── run-migration.ts               # Direct-connection migration runner
├── test-auth-uid.ts               # Sanity-check that auth.uid() returns the internal principalId
└── migrate-users-to-supabase.ts   # One-time Cognito → Supabase migration

tests/
├── screen/   (filters, funnel-state, intent-rules, entity-resolution, market-data-provider, screen-matcher, numeric, routes)
└── server/   (rate-limit)

data/
├── asx/                           # Snapshot JSON (universe, ranked-light, top500, curation)
├── curation.json                  # Curated demo flags for Q5 / Q6 (D4)
├── fund-qa.json                   # Fund Q&A bank: 3 funds × 21 categories
├── process-qa.json                # OC investment-process Q&A: 12 topics
├── reports/                       # Ingest output reports
└── snapshots/                     # Frozen ingest fixtures

docs/
├── ARCHITECTURE.md                # this file
├── INFRASTRUCTURE.md              # external services, env, deployment
├── PROCESSING-STREAMS.md          # concurrent processing streams + activation lifecycles
├── TAVUS-PERSONA-SETUP.md         # how to provision the Pep persona
├── plans/                         # pep-avatar-v2 plan, FSC questionnaire source, pitch script
├── fund-data/                     # Source PDFs + extracted text
└── standards/                     # Generic cross-project architecture guides

instrumentation.ts                  # Next.js startup hook → validateEnv()
next.config.ts                      # Rewrites /api/* → /api/v1/*
```

---

## Key design decisions (locked)

The plan's decision register (`docs/plans/pep-avatar-v2-plan.md` §12) records the load-bearing calls. Highlights:

- **D1 / D2** — v1 demo code is removed from this repo; v1 Supabase tables stay (a separate v1 app reads them). v2 routes use the **inline pattern** (no UoW, no auth) since the demo is fully public.
- **D3** — No live ASX market-data provider. Snapshot-only via `MarketDataProvider` interface (`src/screen/market-data-provider.ts`); future-swappable.
- **D4** — Q5/Q6 use **curated demo flags** (`is_unproven_or_complex_tech`, `is_single_commodity_or_single_mine`) rather than algorithmic classification. Pep's narration discloses this.
- **D5** — Snapshot refresh is manual (`bun scripts/ingest-asx-snapshot.ts`); scheduled refresh is a future concern.
- **D7** — Q5's "no change" outcome is narrated as "subsumed by profitability" — a curated demo flag, not an automatic classification.

---

## Quality gates

- `bunx tsc --noEmit` — strict TypeScript, no errors.
- `bun run lint` — ESLint + Next config; a single pre-existing React-Compiler warning in `components/settings/profile-tab.tsx:79` is documented and unrelated.
- `bun run test` — Vitest. Currently **181/181 green** across 9 files: 8 screening-engine (filters, funnel-state, intent-rules, entity-resolution, market-data-provider, screen-matcher, numeric, routes) plus 1 server (rate-limit). The intent-rules suite has the bulk — it covers funnel-filter triggers, fund-info routing, process-info routing, generic stock-fact patterns, and several cross-rule precedence checks.
