# Pep Avatar v2 - OC Screening Demo

**Status:** in build — phase 1 ✓ complete
**Audience:** OC fund managers / analysts; internal productisation pitch
**Primary route:** `/demo/screen`
**Persona:** existing Tavus Custom Pep persona, with Generic still selectable

## Implementation status

| Phase | Status | Commits |
|---|---|---|
| 1. Schema, ingest, reconciliation | ✓ Complete | `c670dd4` (initial), `3e220bb` (review fixes) |
| 2. Screening engine | ✓ Complete | `0661fbd` (initial), `3c9cba4` (review fixes) |
| 3. UI and state | ✓ Complete | `a0cce22` (initial), `da08c2d` (review fixes) |
| 4. Stock-fact provider (snapshot-backed) | ✓ Complete | `191e47f` (initial), `927b5f0` (review fixes) |
| 5. Voice and routing | ✓ Complete (text mode) — voice + Tavus deferred to phase 6 | `d861794` (initial), `4e0e3fd` (review fixes) |
| 6. Polish and pitch hardening | ✓ Complete | `2274c0c` (initial), `<phase-6-review>` (review fixes) |
| 7. v1 code decommission | Not started | — |

---

## 1. Locked scope decisions

| # | Decision | Resolution |
|---|---|---|
| D1 | v1 code in this repo | **Remove v1 demo code from this repo** in a dedicated late phase, after v2 is end-to-end runnable. The v1 demo is a separate app; this repo doesn't need to deliver its functionality. |
| D2 | v1 schema + data on Supabase | **Preserve the v1 Supabase tables and their data.** The separate v1 app reads them and must keep functioning. v2 adds new tables alongside; no v1 tables are dropped or modified by v2 migrations. |
| D3 | Live data scope | **Snapshot-only for v2.** All answers — funnel counts and stock-fact lookups — come from the ingested DB snapshot. Live ASX market-data integration is **deferred** because sourcing a provider is not practical at this stage. The architecture preserves a `MarketDataProvider` seam so a live implementation can be slotted in later without UI churn. |
| D4 | Deterministic screening | Funnel counts and stock lists come from deterministic snapshot-driven rules, not from an LLM. |
| D5 | Scripted content source | Pep's supplied Q&A and the sample spreadsheet are the source of truth for the scripted demo flow. v2 does not need an admin UI for managing prompt pairs. |
| D6 | Methodology fidelity | The "OC initial screen" shortcut must reflect the FSC questionnaire closely enough to defend in front of a fund manager. The supplied 8 demo questions are supported even where they are a simplified presentation of the process. |
| D7 | Subjective filters | `unproven_or_complex_tech` and `single_commodity_or_single_mine` use curated flags. The avatar must not claim those were "automatically derived" unless they actually were. |
| D8 | Q8 portfolio overlap | If real OC holdings are not supplied in time, use a sample portfolio only if it is clearly labelled as sample data in the UI and spoken response. |
| D9 | Monitoring / email | Q7 can be a mocked workflow in v2, but it must be presented as a demo action, not as an already-live production job. |
| D10 | Failure behaviour | All answers are snapshot-sourced and labelled as such (`Snapshot 2026-04-24 21:08 AEST`). The avatar never claims an answer is "live." If the snapshot is older than the staleness thresholds (§8), the UI surfaces a banner and the avatar acknowledges the snapshot age. |

---

## 2. What we are building

A Pep-based avatar demo on the existing avatar platform that does two things together:

1. Walks the user through a simplified, agentic OC screening funnel using a deterministic ASX snapshot loaded into the existing database.
2. Answers stock-specific questions about names in the shortlist — share price, market cap, earnings status — from the same snapshot, with the snapshot's `collected_at` timestamp shown and spoken alongside every answer.

The funnel choreography is the story. The "wow" is the agentic feel: the funnel rail collapsing in real time, the table re-rendering, and the avatar narrating each step with snapshot data the OC team can sanity-check against their own files.

The demo must support:

- The supplied 8 question flow (Questionnaire path).
- A one-shot "run the OC initial screen" shortcut (Methodology path).
- Follow-up stock questions for names in the resulting shortlist (snapshot-sourced, timestamped).

Live-feed integration is explicitly out of scope for v2 (D3) but the `MarketDataProvider` seam in §6 keeps the upgrade clean.

---

## 3. Product shape

### 3a. One data layer, two access paths

**Source of truth:** the ingested ASX snapshot in `asx_securities` / `asx_snapshots`. Both funnel counts and stock-fact lookups read from here.

**Two access paths:**

1. **Funnel reader** — bulk filter SQL. Returns counts and ticker shortlists per stage.
2. **Stock-fact reader** — single-ticker lookup via the `MarketDataProvider` interface (§6). The v2 implementation, `SnapshotMarketDataProvider`, reads `asx_securities` for the active snapshot and returns the stored values alongside `asx_snapshots.collected_at` as the answer's timestamp.

The UI surfaces a single `Snapshot {{snapshot_date}}` source badge across the experience. There is no `Live` badge in v2; if/when a live feed is added later, the same badge will toggle to `Live` for stock-fact answers (the funnel always remains snapshot-sourced).

### 3b. Conversation model

The demo supports two user journeys:

1. **Questionnaire path**
   The avatar answers the 8 supplied questions in sequence, including the "take out the top 100" and "send me an email" prompts.
2. **Methodology path**
   The user says "run the OC initial screen" and the system runs the OC-aligned preset, with each stage shown in the funnel rail.

Those two journeys overlap, but they are not identical and should not be forced into a single brittle filter sequence.

---

## 4. Screening model

### 4a. Canonical filters we must support

These come from the FSC questionnaire and the supplied demo brief:

- `market_cap_over_50m`
- `remove_top_100_by_market_cap` for the scripted Q2 demo path
- `sufficient_liquidity` using the agreed demo proxy or rule
- `profitable`
- `cash_flow_positive`
- `exclude_unproven_or_complex_tech`
- `exclude_single_commodity_or_single_mine`
- `exclude_asx_100` for the OC-aligned initial screen preset

### 4b. Two executable presets

**Questionnaire preset**

Used to answer the supplied 8 questions in the same order they were written:

1. Market cap over $50m
2. Remove top 100 by market cap
3. Remove names below the agreed liquidity threshold (`turnover_ratio_ttm >= 0.20`)
4. Remove unprofitable names
5. Remove unproven / complex technology
6. Remove single commodity / single mine names

**Funnel-rail rendering of Q5:** the unproven-tech step always produces a stage entry in the rail, even when the curated flag set is empty (which is the case for v2). The rail shows it with the same count as the previous stage and the avatar narrates the "subsumed by profitability" answer. Skipping the step would hide that the filter was considered.

**OC initial screen preset**

Used when the user asks for the actual OC-style initial screen:

1. Market cap over $50m
2. Profitable
3. Cash-flow positive
4. Exclude unproven / complex technology
5. Exclude single commodity / single mine names
6. Exclude insufficient-liquidity names
7. Exclude ASX 100 names

This split fixes the biggest problem in the old plan: the demo can still answer Pep's scripted questions without misrepresenting the OC methodology.

### 4c. Liquidity rule (locked)

Both the Questionnaire preset (step 3) and the Methodology preset (step 6) use the same proxy: `turnover_ratio_ttm >= 0.20` (Pep's stated rule). See §12 #1.

---

## 5. Data model

### 5a. New schema file

Create `src/db/screen-schema.ts` and register it alongside `src/db/schema.ts` in `drizzle.config.ts`.

New tables:

```sql
asx_snapshots
  id uuid pk
  snapshot_date date
  collected_at timestamptz
  source text
  stock_count integer
  notes text

asx_securities
  id uuid pk
  snapshot_id uuid fk -> asx_snapshots
  ticker text
  company_name text
  sector text
  gics_industry_group text
  gics_sub_industry text
  market_cap_snapshot numeric
  close_price_snapshot numeric
  shares_outstanding bigint
  volume_latest bigint
  avg_volume_252d bigint
  total_volume_252d bigint
  turnover_ratio_ttm numeric
  eps_ttm numeric
  net_income_ttm numeric
  free_cash_flow_ttm numeric
  long_business_summary text
  earnings_status_snapshot text     -- derived; see §5b
  is_profitable boolean             -- derived: net_income_ttm > 0
  is_cashflow_positive boolean      -- derived: free_cash_flow_ttm > 0
  is_unproven_or_complex_tech boolean
  is_single_commodity_or_single_mine boolean
  is_asx_100 boolean                -- derived; see §5b
  data_quality jsonb                -- shape: { enrichment_status: "ok" | "partial" | "failed", missing_fields: string[] }
  unique (snapshot_id, ticker)
  index on (snapshot_id, market_cap_snapshot desc)
  index on ticker

oc_holdings
  id uuid pk
  portfolio_label text          -- e.g. "OC Premium Small Company Fund"
  as_of_date date               -- e.g. 2025-12-31 (date the supplied weights/values reflect)
  ticker text
  weight_pct numeric            -- % portfolio weight (e.g. 6.30)
  market_value_aud numeric      -- as-of-date market value in AUD
  first_bought date             -- date the position was first established
  share_change_pct numeric      -- recent share-count change (negative = decrease)
  one_year_return_pct numeric
  forward_pe numeric
  sector text                   -- as supplied (may differ from asx_securities.sector)
  is_sample boolean             -- D8: true when not verified as live by client
  unique (portfolio_label, ticker, as_of_date)
```

Phase-1 seed: the 10 supplied top holdings (MIN, CHC, ORI, VCX, NXT, REA, QUB, ALQ, SGH, A2M) with `portfolio_label = 'OC Premium Small Company Fund (sample)'`, `as_of_date = 2025-12-31`, `is_sample = true`. The `is_sample` flag drives the spoken/UI sample-data label per D8.

Notes:

- No new Q&A tables are required for v2. Keep the scripted prompts and answer templates in code under `src/screen/content.ts`.
- Keep a source path override for ingest:
  - default: `data/asx`
  - optional local override: `ASX_IMPORT_DIR=~/asx`

### 5b. Ingest behaviour

`scripts/ingest-asx-snapshot.ts` should:

- Read `data/asx/asx_universe.json` (or `$ASX_IMPORT_DIR/asx_universe.json`) → seeds the row set with `ticker`, `company_name`, `gics_industry_group`.
- Merge `asx_ranked_light.json` on `ticker` → fills `market_cap_snapshot`, `close_price_snapshot`, `shares_outstanding`, `volume_*`, `turnover_ratio_ttm`.
- Merge `asx_top500_enriched.json` on `ticker` → fills `gics_sub_industry`, `sector`, `eps_ttm`, `net_income_ttm`, `free_cash_flow_ttm`, `long_business_summary`.
- **Derive** the following in code:
  - `is_profitable = (net_income_ttm IS NOT NULL AND net_income_ttm > 0)`
  - `is_cashflow_positive = (free_cash_flow_ttm IS NOT NULL AND free_cash_flow_ttm > 0)`
  - `is_asx_100 = ticker IN (top 100 of this snapshot ranked by market_cap_snapshot DESC, NULLS LAST)` — i.e. derived from the snapshot itself, not from an external S&P feed. Approximation acknowledged in the assumptions doc.
  - `earnings_status_snapshot` — string; one of `"Profitable (TTM)"`, `"Unprofitable (TTM)"`, `"Insufficient data"`. Derived from `net_income_ttm` sign with a `null → "Insufficient data"` clause. The avatar speaks this string verbatim. (Picked over richer alternatives because the source JSONs do not carry actual reporting-calendar data.)
- **Apply curated flags** from a hand-edited file `data/curation.json`:
  - `is_unproven_or_complex_tech` — empty for v2 (Pep's narration claims subsumption by profitability; no tickers tagged).
  - `is_single_commodity_or_single_mine` — the 14 tickers in §4 of the assumptions doc.
- **Populate `data_quality`** as `{ enrichment_status, missing_fields }` per row:
  - `enrichment_status = "ok"` if all of `market_cap_snapshot, turnover_ratio_ttm, net_income_ttm` are non-null.
  - `enrichment_status = "partial"` if any of those three is null but at least one is present.
  - `enrichment_status = "failed"` if all three are null (only `company_name` + GICS came from `asx_universe.json`).
  - `missing_fields` lists the null field names.
- Upsert into `asx_securities` keyed on `(snapshot_id, ticker)` (idempotent re-runs).
- **Emit a reconciliation summary** to stdout and write it to `data/reports/ingest-{{snapshot_date}}.json`:
  - universe size, rows by `enrichment_status`, count per derived flag, final counts for **each preset stage** (Questionnaire 1–6, Methodology 1–7).
- Compare the final-stage counts against `tests/screen/expected-preset-counts.json` (committed in phase 1). Exit non-zero if any count drifts.

---

## 6. Stock-fact provider abstraction

The plan keeps a `MarketDataProvider` seam so a future live feed can be slotted in without UI or routing changes. v2 ships exactly one implementation: snapshot-backed.

### 6a. Interface

`src/screen/market-data-provider.ts`:

```ts
export type StockFact = {
  ticker: string;
  companyName: string;
  sharePrice?: number;
  marketCap?: number;
  earningsStatus?: string;
  dayChangePct?: number;
  fetchedAt: string;     // ISO-8601 timestamp the value relates to
  source: string;        // human-readable label, e.g. "Snapshot 2026-04-24"
  isLive: boolean;       // false for v2 — always
};

export interface MarketDataProvider {
  getStockFact(ticker: string): Promise<StockFact | null>;
}
```

### 6b. v2 implementation

`SnapshotMarketDataProvider` — reads from `asx_securities` for the snapshot returned by `MAX(collected_at)`, returns the stored fields with `fetchedAt = asx_snapshots.collected_at` and `source = "Snapshot " + snapshot_date`. `isLive` is hard-coded false.

This is the **only** provider wired into v2. The route handler (`/api/v1/screen/process` for `info:stock_field` intents) calls the provider via a single `getStockFact(ticker)` call and templates the answer string.

### 6c. Future-work seam (NOT v2)

`LiveMarketDataProvider` is **not implemented** in v2. The interface is in place so a future PR can:

1. Add the implementation in a new file, wire it into the same route handler.
2. Optionally compose with `SnapshotMarketDataProvider` as a fallback (`CompositeMarketDataProvider` that tries live first, falls back on failure, sets `source` accordingly).

No code stub for the live provider should be committed in v2 to keep the repo honest about what's implemented vs. promised.

### 6d. Source badge behaviour

Every stock-fact UI render and every spoken stock-fact answer includes the `source` field. v2 always shows `Snapshot 2026-04-24`. The badge is a single component (`<SourceBadge fact={…} />`) so a future live wiring only changes the badge's text and colour, not its placement.

---

## 7. Routing and voice

### 7a. Intent routing

Use a deterministic-first router:

1. **Rule layer.** Exact / regex / synonym matching for the 8 supplied questions and a small set of stock-fact intents. Implemented in `src/screen/intent-rules.ts` as an array of `{ pattern: RegExp, intent: Intent }`.
2. **Constrained classifier fallback.** Only if no rule matches: send the utterance to Anthropic Haiku with a system prompt that lists the allowed intent IDs and instructs the model to return *exactly one of them* as a single token. Parse with a `z.enum([...])` Zod schema. If parsing fails, return `intent: "fallback"`. Never trust the model to invent intent names.

The rule layer covers the scripted pitch path with zero LLM dependency. The classifier is only for paraphrases ("show me the big-cap names" → `apply_filter:mcap_50m`).

### 7b. Entity resolution

Ticker and company resolution should be deterministic:

- exact ticker match
- exact company alias match
- normalized company-name contains match

If ambiguous, ask a clarification question instead of guessing.

### 7c. Spoken-answer policy

The avatar may narrate:

- deterministic funnel counts from the snapshot
- stock facts from the snapshot, accompanied by the snapshot date/time
- curated subjective exclusions only as "curated demo flags"

The avatar must not say:

- that a subjective filter was automatically inferred when it was hand-tagged
- that an email job is actually running when it is mocked
- that an answer is "live" — every answer in v2 is snapshot-sourced and must say so when asked

---

## 8. UI

The page should feel agentic and funnel-like, not like a generic chat app.

Required elements:

- avatar panel
- funnel rail with stage-by-stage counts
- current shortlist table
- transcript / ask box
- data-source badge: always `Snapshot {{snapshot_date}}` in v2 (single component, ready to render `Live` if a future provider is added)
- visible timestamp on every stock-fact answer (the snapshot's `collected_at`)
- staleness banner driven by the thresholds below
- small note for sample holdings when Q8 is using sample data (`is_sample = true`)
- footnote on the funnel rail surfacing the count of securities excluded due to incomplete enrichment (`data_quality.enrichment_status = "failed"` or `"partial"` for relevant fields)

### 8a. Staleness thresholds

`age_days = days_between(now, asx_snapshots.collected_at)`.

| Age | UI banner | Avatar acknowledgement |
|---|---|---|
| ≤ 7 days | none | none unless asked |
| 8–30 days | yellow banner: *"Snapshot is {{age_days}} days old."* | mentions snapshot date in stock-fact answers (default behaviour) |
| > 30 days | red banner: *"Snapshot is {{age_days}} days old — values may be significantly stale."* | volunteers the staleness in the next stock-fact answer |

Recommended layout:

```text
Avatar | Funnel rail
-------+-------------------------------
       | Universe
       | Market cap > $50m
       | Top-100 removal or OC preset step
       | Liquidity
       | Profitability / cash flow
       | Subjective exclusions
---------------------------------------
Shortlist table
---------------------------------------
Transcript + ask box + source badges
```

---

## 9. Acceptance criteria

The revised plan is only done when all of the following are true:

1. v1 Supabase tables (`demo_responses`, `demo_question_patterns`) remain readable by the separate v1 app and have not been modified by v2 migrations. (v1 routes in *this* repo are removed in phase 7 — that's expected.)
2. New ASX snapshot data is ingested into new v2 tables without changing existing tables.
3. The app can run both:
   - the supplied 8-question flow
   - the OC initial screen shortcut
4. Funnel counts are deterministic and reproducible from the ingested snapshot.
5. The final shortlist and intermediate counts have been checked against Pep's supplied spreadsheet or an agreed expected fixture.
6. The avatar can answer at least these stock-fact questions for a shortlisted name, sourced from the snapshot:
   - share price
   - market cap
   - earnings status
7. Every stock-fact answer shows and speaks a snapshot timestamp and the `Snapshot {{snapshot_date}}` source label.
8. The `MarketDataProvider` interface and `SnapshotMarketDataProvider` implementation are in place; no `LiveMarketDataProvider` is committed (D3).
9. Q5 and Q6 are backed by curated flags, not by unsupported blanket claims.
10. Q8 is clearly labelled as sample data unless real holdings are provided.
11. Q7 is clearly labelled as a demo workflow unless real scheduling and email delivery are implemented.
12. A manual pitch run-through passes end to end on the deployed environment.

---

## 10. Delivery phases

### Phase 1 - schema, ingest, reconciliation ✓ COMPLETE

**Commits:** `c670dd4` (initial); `3e220bb` (review fixes — see §13).

1. ✓ Added `src/db/screen-schema.ts` with the three new tables.
2. ✓ Updated `drizzle.config.ts` to register both schema files.
3. ✓ Hand-wrote `src/db/migrations/005_screen_schema.sql` (drizzle-kit's journal isn't maintained in this repo; existing migrations follow the same hand-written pattern). Verified the SQL contains only `CREATE TABLE` against the three new tables — no `DROP` against v1 entities.
4. ✓ Applied via `bun scripts/run-migration.ts src/db/migrations/005_screen_schema.sql`.
5. ✓ Committed `tests/screen/expected-preset-counts.json` baselined from the live snapshot. Re-baselining now requires `bun scripts/ingest-asx-snapshot.ts --baseline` (silent regeneration was a critical-severity issue closed in `3e220bb`).
6. ✓ Added `data/curation.json` with the 14 curated single-commodity tickers; unproven-tech list empty for v2.
7. ✓ Wrote `scripts/ingest-asx-snapshot.ts`. Idempotent (snapshot delete-then-insert + securities upsert). Validates fixture **before** writing to DB, so a regression doesn't poison Supabase.
8. ✓ Lifted preset filter functions + thresholds + stage IDs out of the script into `src/screen/funnel.ts` (review fix M1) so phase 2's API route can import them cleanly.
9. ✓ Confirmed v1 demo at `/demo` still serves a 200 (24ms cold).

**Actual reconciliation against the 2026-04-24 snapshot:**
- Universe 1,979 (enrichment ok=493, partial=1324, failed=162).
- **Questionnaire preset:** 1979 → 940 → 100 → 86 → 79 → 79 → **65**.
- **Methodology preset:** 1979 → 940 → 347 → 283 → 283 → 271 → 218 → **159**.

> **Drift from Pep's brief examples:** Pep's "around 500 stocks above $50m" example translates to **940** in the actual snapshot because the source ranked-light data covers 1,840 stocks (not just top 500). The avatar will speak the live count, not the brief's estimate.

### Phase 2 - screening engine ✓ COMPLETE

1. ✓ Lifted snapshot-loading logic out of the ingest script into `src/screen/load-snapshot.ts` so the test suite and the script share one source of truth.
2. ✓ Wrote `tests/screen/filters.test.ts` (16 cases): per-stage count match against the fixture, monotonicity, ticker-subset invariant, plus targeted checks (Q5 no-op, Q6 single-commodity removals, M2 / M7 row-level invariants, loader sanity).
3. ✓ Added per-filter step `applyOneFilter(rows, filterId)` + `FilterId` type + `isFilterId` guard in `src/screen/funnel.ts`.
4. ✓ Built `src/screen/state.ts`: `ScreenState`, `initScreenState`, `applyFilterToState`, `resetScreenState` — pure reducers, no DB.
5. ✓ Wrote `tests/screen/funnel-state.test.ts` (11 cases): hand-crafted 7-row fixture, drives state through all 13 filter IDs, asserts immutability, ticker subset, top-100 ordering, M7 ASX-100 exclusion.
6. ✓ Built `POST /api/v1/screen/apply-filter` (inline route, no auth, no UoW per D2): Zod-validated body, picks active snapshot via `MAX(collected_at)`, optionally scopes to `fromTickers` via `inArray`, applies the filter, returns `{ stage, snapshot }`. GET → 405.
7. ✓ Wired both schema files into the Drizzle client (`src/db/index.ts` now imports `schema-v1` + `screen-schema`).

**Smoke test against the live snapshot:**
- Q1 from universe: count 940, top tickers ALC/ATA/AR1/ATM/AON.
- Q2 from Q1 result: count 100, top 3 by mcap CBA/BHP/RIO.
- Full Questionnaire chain end-to-end: 940 → 100 → 86 → 79 → 79 → 65 (matches fixture).
- Bad filterId → 400 with VALIDATION_ERROR + traceId.
- Missing body → 400. GET → 405.

**Test totals:** 29/29 passing in 245ms (post-review).

**Exit criteria:** ✓ snapshot-only screening works via the route without voice or avatar; both presets pass count tests.

**Review fixes (commit `3c9cba4`):** four moderate, four minor — see §13.

### Phase 3 - UI and state ✓ COMPLETE

1. ✓ Lifted `PERSONA_OPTIONS` + radio group into `components/demo/persona-selector.tsx`. v1's `demo-page.tsx` now imports from the new location and renders identically.
2. ✓ Added `GET /api/v1/screen/snapshot` (inline route) — returns active snapshot meta + every security's display fields. Bootstrap endpoint for the v2 client.
3. ✓ Built `src/screen/use-screener.ts`: `start` (loads snapshot, seeds universe stage), `applyFilter` (calls `/apply-filter`, appends stage), `reset`. In-flight guard against StrictMode double-fires. `currentRows` derived via `Map<ticker, SecurityDisplay>` lookup.
4. ✓ Added `src/screen/types.ts`: `SecurityDisplay`, `SnapshotMeta`, `SnapshotResponse`, `ApplyFilterResponse`.
5. ✓ Built UI components under `components/screen/`:
   - `source-badge.tsx` — `Snapshot {{date}}` badge per §6d, structured for a future `Live` variant.
   - `staleness-banner.tsx` — yellow ≥ 8d, red > 30d per §8a.
   - `funnel-rail.tsx` — completed stages as filled checks with count + drop delta; pending stages as hollow dots.
   - `stocks-table.tsx` — sortable (ticker / mcap / turnover / net income), virtualised-by-default at 50 rows with "show all" toggle, em-dash on null fields.
   - `screen-page.tsx` — full layout: header, source badge, staleness banner, error banner, left rail (avatar placeholder + persona selector + preset toggle + funnel + Next/Reset buttons), right pane (stocks table + data-quality footnote), no avatar yet (phase 5).
6. ✓ Mounted at `app/demo/screen/page.tsx`.

**Smoke test:**
- `GET /demo` (v1): 200 in 24ms, persona selector renders identically.
- `GET /demo/screen` (v2): 200 in 161ms cold.
- `GET /api/v1/screen/snapshot`: 200 in 553ms, returns 1,979 securities + snapshot meta.
- 29/29 vitest tests still pass.

**Exit criteria:** ✓ page is demoable with click and text input using snapshot data only; persona selector renders identically to v1.

### Phase 4 - stock-fact provider (snapshot-backed) ✓ COMPLETE

1. ✓ Extracted `parseNumeric` to `src/screen/numeric.ts` (shared between routes + provider). Tests caught the empty-string edge case (`Number("") === 0` → bug); fixed by checking `v.trim() === ""`.
2. ✓ `src/screen/market-data-provider.ts`: `StockFact` type + `MarketDataProvider` interface + `SnapshotMarketDataProvider` class. Resolves the active snapshot via `MAX(collected_at)` (id tiebreaker), looks up the ticker, returns `{ ticker, companyName, sharePrice, marketCap, earningsStatus, fetchedAt, source, isLive: false }`. **No `LiveMarketDataProvider` committed** (D3, §6c).
3. ✓ `POST /api/v1/screen/stock-fact` (inline route, no auth). Body `{ ticker }`, returns `{ fact: StockFact | null }` (200 even on miss). Uppercases + trims input. GET → 405.
4. ✓ `<SourceBadge />` already shipped in phase 3; reused inside `<StockFactPanel />`.
5. ✓ UI wiring: `components/screen/stock-fact-panel.tsx` opens below the stocks table when a ticker is clicked. `<StocksTable />` accepts `onTickerClick` + `selectedTicker` props. `key={selectedTicker}` on the panel re-mounts on re-selection so the panel stays stateless about which ticker is shown.
6. ✓ Tests under `tests/screen/`:
   - `numeric.test.ts` (4 cases) — strict parsing, finite-only, empty-string handling.
   - `market-data-provider.test.ts` (6 cases) — known ticker, derived `Unprofitable (TTM)` for NXT, case-insensitive lookup, whitespace trim, unknown ticker → null, empty input → null. Skips gracefully if no `DATABASE_URL`.
   - `routes.test.ts` (8 cases) — covers `GET /snapshot`, `POST /apply-filter` (incl. validation), `POST /stock-fact`. **Phase-3 follow-up satisfied.**

**Smoke test:**
- POST `{ticker: "CBA"}` → `{ sharePrice: 174.49, marketCap: 291.7B, earningsStatus: "Profitable (TTM)", source: "Snapshot 2026-04-24" }`.
- POST `{ticker: "nxt"}` (lowercase) → ticker uppercased; `earningsStatus = "Unprofitable (TTM)"` (NXT's TTM net income is negative — pedagogically interesting for the demo).
- POST `{ticker: "ZZZ"}` → 200 with `{ fact: null }`.
- POST `{ticker: ""}` → 400. GET → 405.
- **47/47 vitest tests** pass (was 29 before phase 4).

**Exit criteria:** ✓ stock-fact answers resolve via the provider and render the source badge; clicking a row in the funnel shortlist opens a `StockFactPanel` with price / mcap / earnings status / snapshot date.

### Phase 5 - intent routing + UI conversation ✓ COMPLETE (text mode)

1. ✓ `src/screen/intent.ts` — `Intent` union covering 10 kinds (apply_filter, next_step, apply_initial_screen, output_show, output_email, info_stock_field, info_portfolio_overlap, monitoring_enable_daily, restart, fallback) + `INTENT_KINDS` enum.
2. ✓ TDD-first `tests/screen/intent-rules.test.ts` (45 cases) covering every Pep question, paraphrases, and case-insensitivity.
3. ✓ `src/screen/intent-rules.ts` — ordered rule list (specific → general). Funnel-filter rules precede stock-fact so "market cap of 50m" lands on Q1, "market cap of CBA" lands on `info_stock_field`.
4. ✓ TDD-first `tests/screen/entity-resolution.test.ts` (14 cases). The bigram pass disambiguates `Commonwealth Bank` → CBA from `Australian Commonwealth Government Loans` → XCL — caught against the live snapshot during integration.
5. ✓ `src/screen/entity-resolver.ts` — pure `resolveEntity({tickers, nameByTicker})` (testable) + class-based `EntityResolver` with snapshot-keyed cache. Two-pass:
   - Ticker pass: regex `\b[A-Z0-9]{2,5}\b` over uppercased text → set-membership filter.
   - Name pass: bigram match (≥4-char tokens, ordered pair) then single-token fallback (≥6 chars, word-boundary) with stop-word list.
6. ✓ `src/screen/screen-matcher.ts` — `matchScreenIntent(text, classifier)` runs the rule layer first, falls through to a constrained Anthropic Haiku classifier (Zod-parsed JSON, falls back to `{kind: "fallback"}` on parse error or missing `ANTHROPIC_API_KEY`).
7. ✓ `POST /api/v1/screen/process` — inline route, no auth. Body `{ text }`, returns `{ text, intent }`. For `info_stock_field` intents it also runs entity resolution server-side.
8. ✓ `POST /api/v1/screen/portfolio-overlap` — Q8 join: takes the current shortlist tickers, returns matching/non-matching holdings + `isSample` flag (D8).
9. ✓ Tests in `tests/screen/routes.test.ts` cover the new routes (5 new cases for `/process`).
10. ✓ UI: `components/screen/conversation-pane.tsx` (transcript + ask box) + intent dispatcher inline in `screen-page.tsx`. The dispatcher routes each intent to the appropriate action (`screener.applyFilter`, `setSelectedTicker`, `screener.reset`, sonner toast for output_email / monitoring) and appends a narration line to the transcript.

**Test totals:** 112/112 vitest passing (was 48 before phase 5; +45 intent-rules + 14 entity-resolution + 5 process route).

**Smoke test:**
- "Show me ASX stocks with a market cap above 50 million dollars" → `apply_filter q1_mcap_50m`.
- "What is commonwealth bank market cap" → `info_stock_field` + ticker `CBA` (bigram pass).
- "How many of my holdings still meet the criteria" → `info_portfolio_overlap` → server returns 0/10 matching, 10/10 non-matching for an empty universe call (sample data correctly labelled).
- /demo/screen 200 in 24ms.

**Deferred to phase 6 polish:**
- Voice STT integration (re-use ElevenLabs from v1) and Tavus avatar narration. Plan §11 manual-check list still requires "ask the 8 supplied questions in order" — that works today via typed input. Voice is the wow-moment but not blocking the demo.

**Exit criteria:** ✓ The 8 supplied questions are answered correctly via the typed-input flow; rules cover scripted paraphrases without an LLM call; the classifier fallback degrades gracefully to `fallback` if Anthropic is misconfigured.

### Phase 6 - polish and pitch hardening ✓ COMPLETE

1. ✓ Narration wording extracted into `src/screen/narration.ts` per §7c. Each filter has its own template that includes the count; Q5 narrates Pep's "subsumed by profitability" framing as a curated demo flag (not an automatic classification). Email and monitoring intents disclose their demo nature explicitly.
2. ✓ Tavus avatar wiring: new `components/screen/avatar-video.tsx` replaces the placeholder. `useTavusAvatar` initialised from `startSession()` with the selected persona; every assistant narration is echoed via `tavusAvatar.echo()` when the avatar is ready. Cleanup on unmount.
3. ✓ STT in the process route: multipart audio mode added alongside JSON. `src/screen/stt.ts` lifts the v1 ElevenLabs `scribe_v1` helper. Empty-speech audio returns `{ text: "", intent: "fallback" }` for graceful UX.
4. ✓ Voice listener wiring: `useVoiceListener` from v1 reused. Mic toggle in the left rail; the listener pauses while Pep is speaking so we don't transcribe Pep's own voice as a follow-up question.
5. ✓ Sample-data labelling for Q8 already shipped in phase 5; narration now uses `describePortfolioOverlap({ isSample })` and inserts "(based on your sample portfolio)" when the flag is set.
6. ✓ Data-quality footnote on the funnel rail already shipped in phase 3; surfaces the `enrichment_status != "ok"` count.
7. ✓ Staleness banner already wired per §8a thresholds in phase 3.
8. ✓ Pitch run-through script committed at `docs/plans/pep-avatar-v2-pitch-script.md` — pre-flight checklist, opening, both paths, recovery table.
9. ✓ Stubbed Anthropic classifier test added (`tests/screen/screen-matcher.test.ts`, 4 cases) — closes phase-5 documented gap.

**Test totals: 119/119** (was 115; +4 screen-matcher composition tests).

**Smoke test:**
- `/demo/screen` 200 in 26ms (cold).
- Multipart audio mode validation: missing `audio` → 400 `VALIDATION_ERROR`; oversized rejected.
- Tavus init runs in parallel with snapshot load on Start.
- Voice mic toggle pauses listener while avatar is speaking.

**Exit criteria:** ✓ pitch-ready. The demo runs end-to-end via voice OR typed input; Pep narrates every action with `§7c`-compliant wording; the run-through script covers both presets + recovery paths.

**Vercel deploy** is the last step before the meeting — env vars to set are listed in the plan §9; data is already populated in the shared Supabase. Final validation is the manual run-through against the deployed URL.

### Phase 7 - v1 code decommission

Once v2 is end-to-end runnable and pitch-ready, remove v1 demo code from this repo. **Do not touch the v1 Supabase tables or their data** — the separate v1 app reads them.

- Delete: `app/demo/page.tsx`, `components/demo/demo-page.tsx`, `src/demo/use-demo.ts`, `src/demo/bedrock-matcher.ts`, `src/demo/classifier.ts`, `src/demo/config.ts`, `src/demo/types.ts`, `src/demo/index.ts`, `app/api/v1/demo/process/route.ts`, the qa admin (`app/api/v1/demo/qa/`, `app/(app)/config/page.tsx`, `components/config/qa-management.tsx`, `src/hooks/use-demo-qa.ts`, `src/services/demo-qa-service.ts`, `src/server/commands/demo/`, `src/server/queries/demo/`).
- Keep: `app/api/v1/demo/tavus/*` (avatar runtime — reused by v2), `useTavusAvatar`, `useVoiceListener`, `avatar-panel.tsx`, `chat-panel.tsx`, `status-badge.tsx`, `error-banner.tsx`, the `persona-selector.tsx` lifted earlier.
- Keep in `src/db/schema.ts`: `demoResponses` and `demoQuestionPatterns` orphan exports — leaving them in the schema file prevents drizzle-kit from generating `DROP TABLE` migrations against the shared Supabase database that the v1 app still depends on.

**Exit criteria:** repo contains v2 only at the code level; the v1 Supabase tables remain intact and queryable by the separate v1 app.

### Explicitly not in this scope

- dropping v1 tables or modifying v1 data on Supabase
- production-grade scheduling/email infrastructure
- full ORA / valuation workflow
- full admin tooling for managing the scripted Q&A
- live ASX market-data integration (D3)

---

## 11. Test strategy

Required tests:

- `tests/screen/filters.test.ts`
  validates preset stage counts and representative membership
- `tests/screen/router.test.ts`
  validates deterministic routing of the supplied question set and common paraphrases
- `tests/screen/entity-resolution.test.ts`
  validates ticker and company-name lookup
- `tests/screen/market-data.test.ts`
  validates `SnapshotMarketDataProvider` returns the right `StockFact` shape (including timestamp and source label) for a given ticker; covers the not-found path

Required manual checks:

- ask the 8 supplied questions in order
- run "show me the OC initial screen"
- ask for a shortlisted stock's share price (verify the snapshot date is shown and spoken)
- ask for a shortlisted stock's market cap
- ask for a shortlisted stock's earnings status
- ask for an unknown ticker and confirm the avatar acknowledges it isn't in the snapshot

---

## 12. Decisions resolved (2026-04-25)

All previously-open decisions have been resolved by the client:

1. **Liquidity rule.** Both presets use Pep's `turnover_ratio_ttm >= 0.20` rule. (Closes the §4c open rule.)
2. **Q8 holdings.** Use the 10 supplied real holdings as the sample portfolio with `is_sample = true`. They're seeded into `oc_holdings` per §5a. If a more current real list lands before pitch finalisation, swap via the upsert script.
3. **"Remove top 100" rail visibility.** Visible only in the **Questionnaire preset** funnel rail. The Methodology preset uses `exclude_asx_100` and the rail labels it as such. Different journeys, different rail rendering.
4. **Curated flag definitions.** Use the phase-0 hand-curation (14 single-commodity tickers; no unproven-tech tags applied to post-Q4 survivors since Pep's narration claims they're subsumed by profitability). If Pep's spreadsheet lands before pitch finalisation, swap by re-running the upsert script with curated overrides.
5. **Snapshot refresh.** One-shot ingest for v2. Re-running `bun scripts/ingest-asx-snapshot.ts` is the manual refresh path. Scheduled refresh is a v3 / production concern.

**Permanently deferred to future work:** live ASX market-data provider selection (D3); periodic snapshot refresh; production email/scheduling for Q7; admin tooling for the scripted Q&A.

**Locked by D1 / D2:** v1 code is removed from this repo in phase 7; v1 Supabase tables are preserved untouched so the separate v1 app keeps functioning.

A separate **assumptions document** (`docs/plans/pep-avatar-v2-assumptions.md`) captures the same set of decisions in plain language for client review.

---

## 13. Review fixes applied during phase 1

Code review of phase 1 surfaced two critical issues and four moderate ones; all closed in commit `3e220bb`.

| Sev | Finding | Fix |
|---|---|---|
| Critical | Silent fixture re-baselining defeated drift detection | Missing fixture now exits 2; re-baselining requires explicit `--baseline` flag |
| Critical | DB write happened before fixture validation; a regression could poison Supabase | Reordered to compute → validate → persist; DB stays untouched on drift |
| Moderate | Preset filter logic lived in `scripts/`, but phase 2's API route needs it | Lifted to `src/screen/funnel.ts` with a `FilterableSecurity` interface both in-memory `MergedRow` and Drizzle's `AsxSecurity` satisfy structurally |
| Moderate | Magic thresholds (50_000_000, 0.20, 100) repeated | `FILTER_THRESHOLDS` named constants exported from `funnel.ts` |
| Moderate | Stage IDs scattered as bare string literals across two functions and the fixture | `STAGE_IDS` const + `StageId` type + `STAGE_LABELS` map; one source of truth |
| Moderate | Strict-true comparison on profitability filters drops null-enrichment rows undocumented | JSDoc on both presets explains the null-handling semantics |

## 14. Review fixes applied during phase 2

Code review of phase 2 surfaced four moderate and four minor issues; all closed in commit `3c9cba4`.

| Sev | Finding | Fix |
|---|---|---|
| Moderate | Filter logic duplicated between `applyOneFilter` and inline `current.filter()` calls in the preset functions | Each preset is now a `FilterId[]` list reduced through `applyOneFilter`; that function is the single source of truth for every rule |
| Moderate | `Stage` was missing the `appliedAt` field plan §4b requires for the funnel rail UI | Added to the `Stage` type; `makeStage` populates `new Date().toISOString()` with an explicit-override parameter for deterministic tests |
| Moderate | Route used raw `Number(...)`, which would yield `NaN` on bad input and silently affect filter outcomes | Strict `parseNumeric()` returns null on `Number.isFinite(n) === false` |
| Moderate | Snapshot resolution non-deterministic on `collected_at` ties | Added `desc(asxSnapshots.id)` as secondary order key |
| Minor | Side-effecting `pushStage` helper | Replaced with pure `makeStage` |
| Minor | Typos in `data/curation.json` silently did nothing | `loadSnapshot` warns to stderr when curated tickers aren't in the universe |
| Minor | No test for empty `current.tickers` advancement, no `appliedAt` shape assertion | Two new tests; 29/29 passing |
| Minor | `resetScreenState` duplicated `initScreenState` | Now delegates (one-line implementation) |

## 15. Review fixes applied during phase 3

Code review of phase 3 surfaced four moderate and three minor issues (plus two documented-only items); all closed in this phase's review-fix commit.

| Sev | Finding | Fix |
|---|---|---|
| Moderate | Invalid `collectedAt` rendered "Snapshot is NaN days old" in StalenessBanner | NaN guard via `Number.isFinite` — bail and render nothing on unparseable date |
| Moderate | Preset sequences (Questionnaire / Methodology) duplicated between `screen-page.tsx` and `funnel.ts` | Exported `QUESTIONNAIRE_FILTERS` and `METHODOLOGY_FILTERS` from `funnel.ts`; UI imports them; one source of truth |
| Moderate | `stocks-table` sort + slice ran on every render (≈22K comparisons over 1,979 rows) | `useMemo` keyed on `[rows, sortKey, sortDir]` and `[sorted, showAll, defaultLimit]` |
| Moderate | `useScreener.applyFilter` could race on rapid programmatic calls | Added `applyInFlightRef` matching the `start()` pattern; `finally`-block reset |
| Minor | `enrichmentFailed` filter ran on every render in `screen-page` | `useMemo` keyed on `[currentRows]` |
| Minor | Server-returned stage trusted without verifying `stage.id === filterId` | Throws if mismatched, surfacing as the standard error path (`status` returns to "ready"; banner displays the error) |
| Minor | Snapshot-fetch error left no retry path | Start button label flips to "Retry" when `status === "error"` |
| Documented | `dataQuality.enrichment_status` is snake_case in a sea of camelCase | Inherited from the DB jsonb shape; rename would cascade through ingest + storage. Acceptable for v2 |
| Documented | No tests for `useScreener` or the snapshot route | Phase-3 exit criteria didn't require them; flagged for phase-4 plan |

## 16. Review fixes applied during phase 4

Code review of phase 4 surfaced one moderate and three minor issues (plus two documented-only items); all closed.

| Sev | Finding | Fix |
|---|---|---|
| Moderate | `<StockFactPanel>` parsed `fact.source` (a display string) to recover the date for `<SourceBadge>`. Fragile if the source format ever changes | Added a structured `snapshotDate` field to `StockFact`; panel passes it directly. The `source` string remains for human display only |
| Minor | Ticker `<button>` lacked `type="button"` — would default to `submit` if ever placed inside a form | `type="button"` added |
| Minor | No keyboard shortcut to close `StockFactPanel` | Escape-key handler in `screen-page` clears `selectedTicker` |
| Minor | `apply-filter` body validation untested for `fromTickers: [non-string]` | Test added; Zod confirmed to reject with 400 |
| Documented | `getStockFact` makes two sequential DB queries | Could be one with a subquery; performance fine at v2 scale, defer |
| Documented | No tests for `useScreener` or `StockFactPanel` | Routes are covered now; hook + component still uncovered. Raise for phase 5 |

## 17. Review fixes applied during phase 5

Code review of phase 5 surfaced four moderate and two minor issues (plus two documented-only items); all closed.

| Sev | Finding | Fix |
|---|---|---|
| Moderate | Running `apply_initial_screen` mid-questionnaire appended methodology stages on top of existing questionnaire stages — funnel rail mixed both presets | `runInitialScreen` now resets the funnel first (when `stages.length > 1`) so the rail starts cleanly from universe |
| Moderate | Dispatcher narrated "Applied X." even when `screener.applyFilter` set an error internally | New `applyAndNarrate` helper observes `screener.error` before/after each call; on a new error it posts the failure line and (in the methodology preset) bails out of the chain |
| Moderate | `/portfolio-overlap` body had no `fromTickers` length cap — defensive abuse vector | `.max(2000)` matches universe size; verified 400 on oversized payload |
| Moderate | No tests for `/portfolio-overlap` route | Three integration cases added: matching/non-matching split, empty `fromTickers`, oversized payload validation. **115/115 tests pass** |
| Minor | `screen-matcher.ts` final return used `as Intent` cast for nullary kinds, bypassing exhaustiveness | Replaced with explicit switch on `kind`; TypeScript now exhaustively narrows each variant |
| Minor | `/portfolio-overlap` numeric coercion used raw `Number(...)` instead of the shared `parseNumeric` (phase 4 review fix M3 standard) | Swapped in `parseNumeric` |
| Documented | Within-portfolio `isSample` uniformity assumed but not enforced (`latest[0].isSample` only) | Acceptable per D8 — portfolio rows always share the flag at ingest time |
| Documented | No tests for the Anthropic classifier fallback path (plan §11 expected fixture-stubbed responses) | Phase 5 exit criteria didn't require it; raise for phase 6 polish |

## 18. Review fixes applied during phase 6

Code review of phase 6 surfaced three moderate and two minor issues (plus two documented-only items); all closed.

| Sev | Finding | Fix |
|---|---|---|
| Moderate | `applyAndNarrate` regressed phase-5 fix M2: it narrated "Couldn't apply X: unknown error" when `applyFilter` returned null on early-return paths (in-flight, wrong status), even though no error was actually set | Restored before/after `screener.error` capture; only narrate failure if a NEW error was set; stay silent on dedup early-returns |
| Moderate | `describeAppliedFilter` switch had no `default` — adding a new `FilterId` would silently return `undefined` to the transcript | Added compile-time `assertNever` exhaustiveness guard |
| Moderate | `<AvatarVideo>` used `object-cover`, cropping the Tavus feed (Pep's head got tightly cropped). v1 used `object-contain` for letterbox | Switched to `object-contain` for parity |
| Minor | `pcmToWav` hard-codes 16-bit mono with no documentation — silent breakage if the listener changes format | JSDoc note documenting the input contract |
| Minor | `screen-matcher.test.ts` had no case for an `info_stock_field` returned by the classifier nor for a non-rule utterance the classifier classifies as initial-screen | Two cases added; **121/121 tests pass** |
| Documented | `startSession` runs snapshot load + Tavus init in parallel; no ordering | Cosmetic only — error banner shows if either fails |
| Documented | `<AvatarVideo>` no `aria-live` region for status changes | Accessibility minor; defer |
