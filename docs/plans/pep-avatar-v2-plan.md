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
| 3. UI and state | ✓ Complete | (this commit) |
| 4. Stock-fact provider (snapshot-backed) | Not started | — |
| 5. Voice and routing | Not started | — |
| 6. Polish and pitch hardening | Not started | — |
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

### Phase 4 - stock-fact provider (snapshot-backed)

- add `MarketDataProvider` interface in `src/screen/market-data-provider.ts`
- implement `SnapshotMarketDataProvider` reading the active snapshot
- add the `<SourceBadge />` UI component
- wire `info:stock_field` intent through the provider

Live-feed implementation is **explicitly deferred** (D3). No `LiveMarketDataProvider` stub is committed.

**Exit criteria:** stock-fact answers (price / mcap / earnings status) for any shortlisted ticker resolve via the provider and render the source badge.

### Phase 5 - voice and routing

1. **Write tests first**:
   - `tests/screen/intent-rules.test.ts` — exact / regex matches for the 8 questions and stock-fact intents.
   - `tests/screen/router.test.ts` — fixture of ~30 paraphrased utterances → expected intents (uses stubbed Anthropic responses captured once; live mode available for local re-record).
   - `tests/screen/entity-resolution.test.ts` — ticker / company-name lookup.
2. Implement `src/screen/intent-rules.ts`, `src/screen/screen-matcher.ts`, `src/screen/entity-resolver.ts`.
3. Build `POST /api/v1/screen/process` (inline route, ElevenLabs STT + matcher + entity resolver).
4. Connect responses to `tavusAvatar.echo()`.

**Exit criteria:** the 8 supplied spoken questions work reliably; classifier-fallback paraphrases route correctly per the fixture.

### Phase 6 - polish and pitch hardening

- tighten answer wording per the spoken-answer policy (§7c)
- add sample-data labelling for Q8 (`is_sample = true` rows)
- add data-quality footnote on the funnel rail surfacing the `data_quality.enrichment_status != "ok"` count
- wire the staleness banner per §8a thresholds
- add manual run-through script at `docs/plans/pep-avatar-v2-pitch-script.md`
- deploy to Vercel; run the manual script end-to-end against the deployed snapshot

**Exit criteria:** pitch-ready.

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
