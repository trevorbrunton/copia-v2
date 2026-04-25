# Pep Avatar v2 - OC Screening Demo

**Status:** revised draft aligned to the brief
**Audience:** OC fund managers / analysts; internal productisation pitch
**Primary route:** `/demo/screen`
**Persona:** existing Tavus Custom Pep persona, with Generic still selectable

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
3. Remove names below the agreed liquidity threshold
4. Remove unprofitable names
5. Remove unproven / complex technology
6. Remove single commodity / single mine names

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

### 4c. Open rule requiring explicit agreement

One rule is still not locked by the brief and should be called out in the plan instead of hidden in implementation:

- **Liquidity rule:** for the questionnaire flow, use the supplied `annual turnover >= 20%` rule. For the OC methodology preset, either use the same proxy for demo simplicity or implement the questionnaire's more literal liquidity interpretation. This choice must be written down before build starts.

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
  turnover_ratio_ttm numeric
  net_income_ttm numeric
  free_cash_flow_ttm numeric
  earnings_status_snapshot text
  is_profitable boolean
  is_cashflow_positive boolean
  is_unproven_or_complex_tech boolean
  is_single_commodity_or_single_mine boolean
  is_asx_100 boolean
  data_quality jsonb
  unique (snapshot_id, ticker)

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

- Read the prepared ASX files.
- Upsert the current snapshot into the new v2 tables.
- Derive `is_profitable` and `is_cashflow_positive` from numeric fields.
- Apply curated flags for:
  - `is_unproven_or_complex_tech`
  - `is_single_commodity_or_single_mine`
  - `is_asx_100`
- Emit a reconciliation summary at the end:
  - universe size
  - rows with missing market cap
  - rows with missing profitability data
  - final counts for each preset

The ingest step is not complete until those counts have been reviewed against Pep's spreadsheet or an agreed expected fixture.

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

1. Exact / regex / synonym matching for the 8 supplied questions and a small set of stock-fact intents.
2. Only if no rule matches, use a constrained classifier that can choose from the known intents only.

This keeps the scripted pitch path robust while still handling paraphrases.

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
- staleness banner per the thresholds in §5/§9
- small note for sample holdings if Q8 is not using real portfolio data

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

1. Existing demo routes and existing demo tables still work.
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

### Phase 1 - schema, ingest, reconciliation

- Add `src/db/screen-schema.ts`
- update `drizzle.config.ts` to include both schema files
- add ingest script
- load `data/asx/*` into the new tables
- derive the required flags and fields
- reconcile counts against Pep material

**Exit criteria:** DB populated, existing demo unaffected, reconciliation report checked in or saved with the plan.

### Phase 2 - screening engine

- implement filter engine and preset runner
- support both the questionnaire preset and OC initial screen preset
- add deterministic tests for stage counts and membership

**Exit criteria:** snapshot-only screening works without voice or avatar.

### Phase 3 - UI and state

- build `/demo/screen`
- add funnel rail, shortlist table, transcript, source badges
- preserve existing persona selector behaviour

**Exit criteria:** page is demoable with click and text input using snapshot data only.

### Phase 4 - stock-fact provider (snapshot-backed)

- add `MarketDataProvider` interface in `src/screen/market-data-provider.ts`
- implement `SnapshotMarketDataProvider` reading the active snapshot
- add the `<SourceBadge />` UI component
- wire `info:stock_field` intent through the provider

Live-feed implementation is **explicitly deferred** (D3). No `LiveMarketDataProvider` stub is committed.

**Exit criteria:** stock-fact answers (price / mcap / earnings status) for any shortlisted ticker resolve via the provider and render the source badge.

### Phase 5 - voice and routing

- wire STT
- add deterministic-first intent router
- add constrained fallback classifier only for paraphrases
- connect responses to Tavus echo

**Exit criteria:** the 8 supplied spoken questions work reliably in the happy path.

### Phase 6 - polish and pitch hardening

- tighten answer wording
- add sample-data labelling where required
- add manual run-through script
- test the deployed environment end-to-end against the snapshot

**Exit criteria:** pitch-ready.

### Phase 7 - v1 code decommission

Once v2 is end-to-end runnable and pitch-ready, remove v1 demo code from this repo. **Do not touch the v1 Supabase tables or their data** — the separate v1 app reads them.

- Delete: `app/(public)/demo/page.tsx`-equivalent v1 route, `components/demo/demo-page.tsx`, `src/demo/use-demo.ts`, `src/demo/bedrock-matcher.ts`, `src/demo/classifier.ts`, `src/demo/config.ts`, `src/demo/types.ts`, `src/demo/index.ts`, `app/api/v1/demo/process/route.ts`, the qa admin (`app/api/v1/demo/qa/`, `app/(app)/config/page.tsx`, `components/config/qa-management.tsx`, `src/hooks/use-demo-qa.ts`, `src/services/demo-qa-service.ts`, `src/server/{commands,queries}/demo/*`).
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
