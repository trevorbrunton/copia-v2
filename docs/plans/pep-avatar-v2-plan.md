# Pep Avatar v2 — OC Screening Demo

**Status:** decided — ready to build
**Audience for the demo:** OC fund managers / analysts (Robert Frost, Pep Perry et al.) — internal productisation pitch of the OC Premium Small Company Fund initial-screen workflow
**Persona on screen:** Pep, served by the existing Tavus "Custom" persona (`NEXT_PUBLIC_TAVUS_PERSONA_CUSTOM=pa378f4d4faf`); the demo also retains the "Generic" selector option (`NEXT_PUBLIC_TAVUS_PERSONA_GENERIC=p9e3e1a0de0b`).

---

## 1. Decisions (locked)

| # | Decision | Resolution |
|---|---|---|
| D1 | Route + v1 fate | New demo lives at **`/demo/screen`**. The v1 OC Mid-Cap demo **code** in this repo is deleted (it doesn't ship from this repo any more). The v1 **Supabase tables** (`demo_responses`, `demo_question_patterns`) are preserved untouched on the database — a separate v1 app continues to read them. |
| D2 | Conversation style | **State-aware classifier with a `next_step` intent** — funnel can be advanced by saying "next step" or by naming any specific filter; ad-hoc info questions route to a separate intent. |
| D3 | Single-commodity flag | **Hand-curated** — see §4a for the 14 tickers. |
| D4 | OC current-portfolio holdings (Q8) | **Fictional curated list** for v2; real list to be sourced. See §8. |
| D5 | Avatar audio | **Live Tavus echo only** for v2. Fallback options noted in §8. |
| D6 | ASX data freshness | **Static snapshot from the database**. Live feed adapter is future work. |
| D7 | Pep persona | Re-use the existing **Custom** Tavus persona; selector still exposes both Generic and Custom options. |
| D8 | Old plan docs | Deleted. |
| B1 | Schema separation | v2 entities live in a new file `src/db/screen-schema.ts` registered alongside `src/db/schema.ts` in `drizzle.config.ts` via the `schema` array. v1 entries in `schema.ts` are left in place so drizzle-kit doesn't generate `DROP TABLE` migrations against them. New v2 table names are non-colliding. |
| B2 | Architecture pattern | New `/api/v1/screen/*` routes follow the **inline pattern** already used by `app/api/v1/demo/process/route.ts` and `tavus/route.ts` — no `requireAuthContext`, no UoW, no `commands/`/`queries/` layer. The demo is unauthenticated and the layered pattern adds no value here. |
| B3 | Phase ordering | v1 code is **not** removed in phase 1. Phase 1 only adds v2 schema + data. v1 code deletion happens in a dedicated phase 7 once v2 is end-to-end runnable. |

---

## 2. What we're building

A demo at **`/demo/screen`** that walks the user through the OC Premium Small Company Fund initial-screen funnel, narrowing the ~1,979-stock ASX universe down to a ~65-name OC initial-screen list. The avatar (Pep) narrates each filter; the UI shows the funnel collapsing in real time with counts ticking down, the stocks table re-rendering with the new shortlist, and a snapshot timestamp visible at all times.

After the funnel completes, the user can ask ad-hoc questions about stocks in the resulting list — answered from the same DB snapshot. The "live" feel comes from the visible `as of HH:MM AEST` tagline; a live-feed adapter slots in later without UI change.

The funnel is **scripted-deterministic** (filters are SQL, counts are real). The avatar's job is presentation, not arithmetic — no LLM-invented numbers anywhere.

---

## 3. What it proves to the client

- We can productise OC's analyst grunt-work into a repeatable, narratable workflow.
- Any criterion they articulate, we can slice the universe against (the 5 demo filters are exemplars; the engine is general).
- Live market data — once plugged in — gives the answers a credible "as of HH:MM" timestamp.
- The agent can run the screen on a schedule and surface diffs (Q7).

---

## 4. Architecture

### 4a. Data model (new file `src/db/screen-schema.ts`)

```sql
-- (drizzle entities; SQL types shown for clarity)

asx_snapshots
  id            uuid pk
  snapshot_date date
  collected_at  timestamptz
  source        text          -- 'ranked_light' | 'top500_enriched' | 'asx_universe'
  stock_count   integer

asx_securities
  id           uuid pk
  snapshot_id  uuid fk → asx_snapshots
  ticker       text
  company_name text
  gics_industry_group   text
  gics_sub_industry     text
  sector       text
  market_cap   numeric
  close_price  numeric
  shares_outstanding bigint
  volume_latest      bigint
  avg_volume_252d    bigint
  total_volume_252d  bigint
  turnover_ratio_ttm numeric
  eps_ttm            numeric
  net_income_ttm     numeric
  free_cash_flow_ttm numeric
  long_business_summary text
  is_unproven_tech    boolean default false
  is_single_commodity boolean default false
  unique (snapshot_id, ticker)
  index on (snapshot_id, market_cap desc)
  index on ticker

oc_holdings              -- for Q8 portfolio-overlap
  ticker text pk
  weight numeric

screen_qa_responses
  id        uuid pk
  category  text unique   -- 'q1_mcap_50m' | 'q2_top100' | … | 'fallback'
  label     text
  answer_template text    -- supports {{count}}, {{first_ticker}}, {{last_ticker}}, …

screen_qa_patterns
  id          uuid pk
  response_id uuid fk → screen_qa_responses (on delete cascade)
  pattern     text
```

`drizzle.config.ts` is updated to:
```ts
schema: ["./src/db/schema.ts", "./src/db/screen-schema.ts"]
```

**Curated `is_single_commodity = true`:** NST, EVN, PRU, GMD, RMS (gold); SFR, CSC (copper); AAI (aluminium); LYC (rare earths); YAL, WHC (coal); WDS, STO (oil & gas E&P); ALD (oil & gas refining). 14 names. Border calls left **out** of the flag (so they pass): BHP, RIO, FMG, MIN, S32 (multi-commodity); BSL (steel manufacturer); ORI (specialty chemicals).

**Current-snapshot selection (W2 resolved):** queries pick the snapshot with `MAX(collected_at)` from `asx_snapshots`. Single source of truth, simple to reason about. If multi-snapshot rollback becomes a need, add an `is_active` boolean later — no API change required.

### 4b. Funnel state machine

```ts
type FilterId =
  | 'mcap_50m'         // market_cap > 50_000_000
  | 'top_100'          // top 100 by market_cap from previous stage
  | 'turnover_20'      // turnover_ratio_ttm >= 0.20
  | 'profitable'       // net_income_ttm > 0
  | 'unproven_tech'    // !is_unproven_tech (no-op on this snapshot, see §W11)
  | 'single_commodity';// !is_single_commodity

type Stage = {
  id: FilterId | 'universe';
  label: string;        // "Market cap > $50m"
  appliedAt: string;    // ISO timestamp
  count: number;        // |stocks at this stage|
  tickers: string[];    // current shortlist (table-capped at first 200)
};

type ScreenState = {
  snapshotId: string;
  snapshotDate: string;
  snapshotCollectedAt: string;
  stages: Stage[];
  current: Stage;       // == last(stages)
};
```

**`oc_initial` is not a filter ID** — it's an **intent shortcut**. When a user says "run the initial screen," the server applies the 6 filters in sequence and returns the final state plus all intermediate stages so the rail animates through them.

**Endpoint:** `POST /api/v1/screen/apply-filter` with `{ filterId, fromTickers? }` returns `{ stage, snapshot }`. Inline pattern — calls Drizzle/Postgres directly, no UoW, no auth. Filters are pure SQL against `asx_securities` joined to the running ticker set.

### 4c. Conversation routing

**Endpoint:** `POST /api/v1/screen/process` — same multipart audio shape as v1's `process` route, returns `{ text, intent }` where `intent` is one of:

| Intent | Notes |
|---|---|
| `apply_filter:next_step` | Natural next step. Triggered by "next", "continue", "keep going". |
| `apply_filter:<named>` | Out-of-order specific filter. |
| `apply_initial_screen` | Shortcut — runs filters 1–6 in sequence, returns all stages. |
| `output:show` | Re-renders the table with full sortable view. |
| `output:email` | Mocked via toast: "Email queued — check your inbox." No real email. |
| `info:stock_field` | "What's BHP's market cap?" — entity-resolves ticker, returns from snapshot with timestamp. See entity-resolution detail below. |
| `info:portfolio_overlap` | Q8 — joins current shortlist with `oc_holdings`. |
| `monitoring:enable_daily` | Q7 — flips a UI toggle, scripted confirmation. |
| `restart` | Resets the funnel to `universe`. |
| `fallback` | Out-of-scope — scripted polite refusal. |

**Classifier:** `src/screen/screen-matcher.ts` — Anthropic Haiku call. Prompt assembled from the active intent set + `ScreenState.current.id` so it knows what "that list" / "the previous list" refers to.

#### Entity resolution for `info:stock_field` (W4 resolved)

Ticker / company resolution is **deterministic**, no LLM call. The matcher does a two-pass extract on the transcribed text:

1. **Ticker extraction.** Regex `/\b[A-Z]{3}\b/g` over the original transcript (preserve case from STT). Match each candidate against the `tickers` set built from `asx_securities` for the active snapshot. If exactly one matches, resolve.
2. **Company-name extraction.** If no ticker hit, lowercase the transcript and run a substring match (or Postgres `ILIKE`) against `company_name` for the active snapshot. If exactly one company contains a non-trivial substring (length ≥ 3) of a transcript token, resolve to its ticker.

Both passes draw their lookup data from the already-ingested `asx_securities` rows — no new tables or external services required. If both passes fail or yield ambiguous matches, the route returns `intent.kind === 'fallback'` with a "couldn't pin down the company you meant" answer template.

A small boot-time cache (`Map<ticker, company_name>` for the active snapshot) keeps lookups O(1) and avoids hitting the DB for each utterance. Cache invalidates on snapshot change.

### 4d. UI

```
┌──────────────────────────────────────────────────────────────────┐
│ OC Premium Dynamic — Live Screening Demo · snapshot 2026-04-24   │
├────────────────────────┬─────────────────────────────────────────┤
│                        │ Funnel (left rail)                      │
│  Avatar (Tavus stream) │   ●  Universe                  1,979    │
│                        │   ●  Mcap > $50m                 487    │
│                        │   ●  Top 100 by mcap             100    │
│                        │   ●  Turnover ≥ 20%               86    │
│                        │   ●  Profitable                   79    │
│                        │   ●  Unproven tech                79    │  ← W11: stage advances, count unchanged
│                        │   ◌  Single-commodity             65    │
├────────────────────────┴─────────────────────────────────────────┤
│ Stocks table (current stage; sortable, virtualised)              │
│  CBA   Commonwealth Bank …   $291.8B   0.30   $9.2B            ↑ │
│  BHP   BHP Group Limited     $285.0B   …                         │
├──────────────────────────────────────────────────────────────────┤
│ Transcript + ask box (mic + text input)                          │
└──────────────────────────────────────────────────────────────────┘
```

The persona selector (Generic / Custom) appears on the start screen exactly as it does on v1 today — same `PERSONA_OPTIONS` source-of-truth, same env vars.

**Snapshot-staleness banner (W8 resolved):**
- ≤ 7 days old: timestamp shown plain, no banner.
- 8–30 days old: yellow banner "Snapshot is X days old."
- > 30 days old: red banner "Snapshot is X days old — values may be significantly stale."

---

## 5. Eight-question mapping

| Q | Intent | Data | Scripted text shape |
|---|---|---|---|
| 1. Mcap > $50m | `apply_filter:mcap_50m` | `market_cap > 50_000_000` | "There are **{{count}}** stocks on the ASX with a market cap above $50m. Show or email?" |
| 2. Top 100 by mcap | `apply_filter:top_100` | sort desc, take 100 | "Here's the top 100 — **{{first_ticker}}** through **{{last_ticker}}**. Show or email?" |
| 3. Turnover ≥ 20% | `apply_filter:turnover_20` | `turnover_ratio_ttm >= 0.20` | "**{{count}}** of those have annual turnover of 20% or more. Show or email?" |
| 4. Profitable | `apply_filter:profitable` | `net_income_ttm > 0` | "**{{count}}** are profitable on a TTM basis. Show or email?" |
| 5. Unproven / complex tech | `apply_filter:unproven_tech` | `!is_unproven_tech`; **stage IS produced**, count unchanged for this snapshot | "Every stock with unproven tech in our universe also fails the profitability filter — already excluded. **{{count}}** stocks remain." |
| 6. Single-commodity / single-mine | `apply_filter:single_commodity` | `!is_single_commodity` | "Here's the OC initial screen: **{{count}}** names. This matches page 12 of the FSC questionnaire — going forward, just say 'run the initial screen'." |
| 7. Daily email on changes | `monitoring:enable_daily` | UI toggle + mock | "Daily monitoring on. I'll email you at 6am every day — change-or-no-change, your call." |
| 8. Portfolio overlap | `info:portfolio_overlap` | `oc_holdings` ⨝ current shortlist | "**{{matching}}** of your **{{total_holdings}}** current holdings still meet the screen. The **{{nonmatching}}** that don't: …" |

---

## 6. Reuse vs new

| Layer | Action |
|---|---|
| `useTavusAvatar`, `useVoiceListener`, `components/demo/avatar-panel.tsx`, `chat-panel.tsx`, `status-badge.tsx`, `error-banner.tsx` | **Reused.** `avatar-panel`'s haiku branch stays in (W14). |
| `app/demo/page.tsx`, `components/demo/demo-page.tsx` | **Deleted in phase 7** (after v2 is runnable). |
| `src/demo/use-demo.ts`, `bedrock-matcher.ts`, `classifier.ts`, `config.ts`, `types.ts`, `index.ts` | **Deleted in phase 7.** The functionality is reimplemented under `src/screen/`. |
| `app/api/v1/demo/process/` | **Deleted in phase 7.** |
| `app/api/v1/demo/tavus/`, `tavus/[conversationId]/` | **Reused as-is** (v2 mounts the same routes). |
| `app/api/v1/demo/qa/`, `app/(app)/config/page.tsx`, `components/config/qa-management.tsx`, `src/hooks/use-demo-qa.ts`, `src/services/demo-qa-service.ts`, `src/server/{commands,queries}/demo/*` | **Deleted in phase 7** (v2 has no admin UI). |
| `src/db/schema.ts` v1 demo tables (`demoResponses`, `demoQuestionPatterns`) | **Untouched** in this repo's schema file so drizzle-kit does not generate `DROP TABLE` migrations against the shared Supabase database. They remain in `schema.ts` as orphan exports until a separate cleanup pass. |
| New v2 entities (`src/db/screen-schema.ts`) | New file added in phase 1. |
| New code: `src/screen/` | `screen-matcher.ts`, `use-screener.ts`, `funnel-state.ts`, `entity-resolver.ts`, `types.ts`. |
| New components | `components/screen/{screen-page,funnel-rail,stocks-table,staleness-banner}.tsx`. |
| New API routes | `app/api/v1/screen/{apply-filter,process,resolve-ticker?}/route.ts`. |
| New scripts | `scripts/ingest-asx-snapshot.ts` (idempotent upsert from `data/asx/*.json`). |
| Data | `data/asx/asx_universe.json`, `asx_ranked_light.json`, `asx_top500_enriched.json`, `asx_top500_enriched_incomplete_report.csv`, `universe_errors.csv` — copied into the repo. **Ingestion canonical source:** `asx_ranked_light.json` is the row set that populates `asx_securities` (it has `market_cap`, `turnover_ratio_ttm`, etc. — all the fields needed for filters 1–4). `asx_top500_enriched.json` is merged on top by `ticker` to fill in the deeper fields (`net_income_ttm`, `eps_ttm`, `free_cash_flow_ttm`, `gics_sub_industry`, `sector`, `long_business_summary`) where available. `asx_universe.json` (1,979 stocks, ticker + company_name + GICS only) seeds the initial "Universe = 1,979" count and any rows missing from the ranked-light dataset (so the universe stage isn't smaller than the brief implies). |
| Shared persona selector | New `components/demo/persona-selector.tsx` lifts the `PERSONA_OPTIONS` constant + radio group out of `demo-page.tsx` so both v1 (until phase 7) and the new v2 screen page import the same component. Done as a small refactor in phase 3 before v2's `ScreenPage` is wired up. |

---

## 7. Phases

Each phase ends in a runnable demo of its own scope. v1 stays alive until phase 7.

1. **v2 schema + data ingest.** Add `src/db/screen-schema.ts`, update `drizzle.config.ts` to register both schema files. `bun run db:generate` produces a migration for the 5 new tables only (verify before applying that no `DROP TABLE` lines target v1 entities). `scripts/ingest-asx-snapshot.ts` reads `data/asx/*.json`, upserts into `asx_securities` keyed on `(snapshot_id, ticker)`, sets `is_single_commodity` for the 14 curated tickers, seeds a fictional `oc_holdings` (~30 plausible names). **End state:** populated DB; raw SQL runs the funnel and returns the expected counts (487 → 100 → 86 → 79 → 79 → 65).
2. **Funnel server + state hook.** `POST /api/v1/screen/apply-filter`, `useScreener` hook with `ScreenState`. Golden-file unit test (vitest, against the ingested snapshot): applying the 6 filter IDs in order yields the expected counts. Inline route pattern; no auth. **End state:** stub page with click-to-advance buttons and visible stage counts.
3. **Screener UI.** `ScreenPage` (avatar pane + funnel rail + stocks table + transcript + start-screen with persona selector), wired to `useScreener`. Mounted at `/demo/screen`. **End state:** page is visually complete without voice — full funnel runnable by clicking, table animates, snapshot timestamp + staleness banner working.
4. **Entity resolver + classifier.** `src/screen/entity-resolver.ts` (deterministic ticker/company lookup over `asx_securities`), `src/screen/screen-matcher.ts` (Anthropic Haiku for intent classification), seed `screen_qa_responses` + `screen_qa_patterns` for all 8 questions plus `apply_initial_screen` and `fallback`. **End state:** matcher passes a routing test fixture (~30 sample utterances → expected intent).
5. **Conversation routing.** `POST /api/v1/screen/process` ties STT (ElevenLabs) + matcher + entity resolver together. Wires the response template into `tavusAvatar.echo()`. **End state:** voice in → correct intent → state advances → table updates → transcript shows the conversation.
6. **Polish.** Row-diff flash, snapshot-staleness banner colour states, email-mock toast, daily-monitoring toggle, restart button, fallback handling, **data-quality footnote** showing "139 securities excluded due to incomplete enrichment" (W12). **End state:** ready for the OC pitch.
7. **v1 decommission.** Delete v1 demo code (route, components, hooks, services, handlers, qa admin UI, `bedrock-matcher.ts`, etc.) per §6. Schema entries for `demoResponses` / `demoQuestionPatterns` left in `src/db/schema.ts` as orphans (so drizzle-kit doesn't generate drop migrations). **End state:** repo only contains v2; Supabase v1 tables remain intact for the separate v1 app.

Phases 1–6 ≈ **6–8 working days**; phase 7 ≈ **0.5 day**. Total **7–9 working days**.

---

## 8. Test strategy (W5 resolved)

Three categories of tests, each owns a phase:

1. **Filter golden-file** (phase 2). `tests/screen/filters.test.ts`: applies each of the 6 filter IDs in sequence against the ingested snapshot, snapshots `{ stage_id, count, tickers.slice(0, 10) }` to a JSON fixture. Re-running with the same ingested data produces a byte-identical snapshot. Fails loudly on data drift.
2. **Matcher routing fixture** (phase 4). `tests/screen/matcher-routing.test.ts`: a hand-crafted fixture of 30+ `{ utterance, screenState, expectedIntent }` rows covering all intents. Two run modes:
   - **Local / pre-commit:** live Anthropic API call. Catches model drift. Slow + costs ~$0.01/run.
   - **CI:** stubbed Anthropic responses captured once per fixture. Fast + free + deterministic. Re-record when an utterance is added or model changes.
   I recommend committing the stub fixture and having CI fail if it's not present.
3. **State-machine snapshot** (phase 2). `tests/screen/funnel-state.test.ts`: synthetic `ScreenState`, fire each intent, assert resulting state shape. Pure unit test, no DB.

**Out of scope for v2:** no E2E browser test (Playwright). The polish phase is gated by a manual run-through script kept in `docs/plans/v2-demo-script.md`.

---

## 9. Vercel deployment (W10 resolved)

- **App code:** standard Vercel build off `main`. No build-time data dependencies.
- **Database:** the Supabase project already used by this repo (`DATABASE_URL` / `DIRECT_URL`). v1 and v2 tables coexist in the same database; v1 tables are read by the separate v1 app, v2 tables by this one. No collision.
- **Data ingest:** `bun scripts/ingest-asx-snapshot.ts` is run **locally** (uses `DIRECT_URL`) whenever a fresh snapshot is collected. Vercel does not run ingest. The first run of phase 1 populates the production tables; subsequent runs upsert. No build-hook needed, and Vercel deployments do not require any data to be present at build time.
- **Environment variables on Vercel:** `DATABASE_URL`, `DIRECT_URL`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL_ID` (optional), `ELEVENLABS_API_KEY`, `TAVUS_API_KEY`, `TAVUS_REPLICA_ID` (if used), `NEXT_PUBLIC_TAVUS_PERSONA_GENERIC`, `NEXT_PUBLIC_TAVUS_PERSONA_CUSTOM`, `NEXT_PUBLIC_AVATAR_MODE=tavus`, `NEXT_PUBLIC_VAD_SILENCE_TIMEOUT_MS`, `NEXT_PUBLIC_MEDIA_BASE_URL` (optional), `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. Pruned envs from v1 — `NEXT_PUBLIC_PROCESSING_MODE`, `LIVEAVATAR_*`, `NEXT_PUBLIC_ELEVENLABS_AGENT_ID`, `AWS_*`, `GEMINI_*` — should be removed from the Vercel project.

---

## 10. Dev notes (open follow-ups)

### D4 — Real OC current-portfolio holdings for Q8
v2 ships a curated fictional `oc_holdings` set of ~30 plausible small/mid-cap ASX names — a mix that intentionally has some that pass the screen and some that fail one filter, so Q8 has something interesting to say. **TODO:** source the real OC Premium Small Company Fund holdings list — likely from OC's quarterly portfolio report or a direct ask to Pep / OC IR. When obtained, drop the new list as a CSV at `data/oc_holdings.csv` and re-run the seed (upsert by ticker; no migration needed).

### D5 — Pre-rendered avatar audio fallback
v2 uses live Tavus echo only. The v1 haiku-mode pattern (pre-rendered MP4s per category) doesn't translate cleanly because v2 responses are **dynamic** — counts and tickers change per snapshot. Options if a fallback path becomes important:
1. **Per-snapshot pre-render.** Ingestion also pre-renders an MP4 per Q&A category using the snapshot's frozen counts. Stale on next snapshot.
2. **Static prefix + dynamic count overlay.** Pre-render the static phrasing, inject the count as on-screen text only.
3. **ElevenLabs TTS over a still image.** Same templated text → ElevenLabs voice → still of Pep. No lip-sync, always available.
4. **No fallback — accept Tavus risk.** Cleanest if the pitch network is reliable.

### D6 — Live ASX feed (deferred)
DB snapshot carries `collected_at`; UI shows it prominently. When a live feed is added, only `apply-filter` and `info:stock_field` need to call the live adapter for top-of-book values. Provider candidates: ASX Market Data Direct, Refinitiv, IRESS, Yahoo Finance (cheapest, lowest fidelity).

### v1 schema cleanup
After v1 is decommissioned and confirmed not depended on, do a separate cleanup pass to drop `demo_responses` and `demo_question_patterns` from Supabase + remove the orphan exports from `src/db/schema.ts`. Out of scope for v2.

---

## 11. Known approximations

- **Universe size.** Snapshot says 1,979; Pep's brief said ~2,500. The avatar speaks the live snapshot count, not Pep's example.
- **Final list size.** Q1–Q6 land on **~65 names** vs Pep's "~45." Pep's number was approximate; OC's actual fund excludes ASX-100 stocks (per FSC questionnaire §2.2) which would tighten further. v2 does not include the ex-ASX-100 cap because Pep's 8 questions don't include it.
- **Failed enrichments.** 139 of 1,979 lack `market_cap`; they're excluded from market-cap-dependent filters. Surfaced in the UI footnote in phase 6.
- **Q5 unproven-tech claim.** Avatar asserts "every stock with unproven tech is already filtered out by profitability." Scripted; not audited. Acceptable for a pitch.
