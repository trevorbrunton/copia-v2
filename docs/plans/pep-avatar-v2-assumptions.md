# Pep Avatar v2 — Assumptions for Client Verification

**Audience:** OC Funds (Pep Perry, Robert Frost, et al.)
**Purpose:** Every meaningful decision behind the v2 demo, in plain language, so you can confirm or change them before we build.
**How to use this:** read each item; reply with **OK**, **Change to: …**, or **Clarify**. Anything you don't push back on, we treat as locked.

---

## 1. What the demo is

| # | Assumption |
|---|---|
| 1.1 | The demo is a Pep-branded talking avatar that walks a fund manager / analyst through OC's stock-screening process and then answers a small set of follow-up questions about the resulting shortlist. |
| 1.2 | The demo runs in a browser at a URL we control (Vercel). It does not require any install on the OC side. |
| 1.3 | It uses Pep's voice and likeness on our existing avatar platform (Tavus). The "Custom" Tavus persona we've already prepared is used for Pep; a "Generic" persona option is also available. |

## 2. Data sources

| # | Assumption |
|---|---|
| 2.1 | All numbers shown and spoken in v2 come from a **single ASX snapshot** stored in our database. The snapshot date is shown on screen and spoken by the avatar with every stock-fact answer. |
| 2.2 | We are **not** integrating a live ASX market-data feed for v2. Sourcing one isn't practical at this stage. The architecture leaves a clean seam for a live feed to be added later without rebuilding the UI. |
| 2.3 | Every spoken answer about a specific stock includes the snapshot timestamp. The avatar never claims an answer is "live." |
| 2.4 | The current snapshot (collected 24 April 2026) covers ~1,979 ASX-listed securities. About 139 of those failed enrichment and have no market-cap data; they are excluded from market-cap-dependent filters. The UI shows a small footnote disclosing this gap. |

## 3. The screening funnel

We support **two distinct journeys** because Pep's eight illustrative questions are *not* identical to the actual OC methodology and we don't want to misrepresent either.

### 3a. Questionnaire path — answers Pep's eight supplied questions

| Step | Filter | Rule |
|---|---|---|
| 1 | Market cap > $50m | `market_cap > 50,000,000` |
| 2 | Top 100 by market cap | sort descending, keep first 100 |
| 3 | Annual turnover ≥ 20% | `turnover_ratio_ttm >= 0.20` (Pep's stated rule) |
| 4 | Profitable | `net_income_ttm > 0` |
| 5 | Exclude unproven / complex tech | curated flag (see §4) |
| 6 | Exclude single-commodity / single-mine | curated flag (see §4) |

### 3b. Methodology path — answers "run the OC initial screen"

| Step | Filter | Rule |
|---|---|---|
| 1 | Market cap > $50m | as above |
| 2 | Profitable | `net_income_ttm > 0` |
| 3 | Cash-flow positive | `free_cash_flow_ttm > 0` |
| 4 | Exclude unproven / complex tech | curated flag |
| 5 | Exclude single-commodity / single-mine | curated flag |
| 6 | Sufficient liquidity | same `turnover_ratio_ttm >= 0.20` proxy as above |
| 7 | Exclude ASX 100 | curated flag |

| # | Assumption |
|---|---|
| 3.1 | The Questionnaire path mirrors Pep's eight supplied questions in the order they were written. |
| 3.2 | The Methodology path mirrors the OC Premium Small Company Fund's stated initial screen as drawn from the FSC questionnaire (§2.2 of that document). |
| 3.3 | Both paths use Pep's "annual turnover ≥ 20%" rule for liquidity. |
| 3.4 | The "Remove top 100 by market cap" step is visible only in the Questionnaire-path funnel rail. The Methodology path uses "Exclude ASX 100" instead. |

## 4. Curated flags

Two of the OC criteria are inherently subjective and cannot be derived purely from numeric snapshot data:

- *Unproven or complex technology*
- *Single-commodity / single-mine resource stocks*

| # | Assumption |
|---|---|
| 4.1 | These are stored as boolean flags on each security row, populated by hand from the universe data + GICS sub-industry + business summary. |
| 4.2 | The avatar narrates these as **"curated demo flags."** It does not claim they were "automatically derived" or inferred. |
| 4.3 | **Single-commodity / single-mine — initial curated list:** NST, EVN, PRU, GMD, RMS (gold); SFR, CSC (copper); AAI (aluminium); LYC (rare earths); YAL, WHC (coal); WDS, STO (oil & gas E&P); ALD (oil & gas refining). 14 names. Border calls deliberately kept *out* of the flag (so they pass the filter): BHP, RIO, FMG, MIN, S32 (multi-commodity); BSL (steel manufacturer rather than commodity producer); ORI (specialty chemicals, multi-product). |
| 4.4 | **Unproven / complex tech — initial curated list:** none flagged on the current Q4 survivors. The avatar's spoken answer reflects Pep's own scripted narration ("every stock with unproven tech in our universe has already been excluded by the profitability filter") with that wording presented as a curated assertion, not an automatic conclusion. |
| 4.5 | If Pep supplies a more authoritative spreadsheet defining these flags, we'll re-seed the database from it. The current curation is the placeholder until then. |

## 5. The eight supplied questions

| Q | What the avatar says (essential shape) |
|---|---|
| Q1 | "There are **N** stocks on the ASX with a market cap above $50m. Show or email?" |
| Q2 | "Here's the top 100 — **first ticker** through **last ticker**. Show or email?" |
| Q3 | "**N** of those have annual turnover of 20% or more. Show or email?" |
| Q4 | "**N** are profitable on a TTM basis. Show or email?" |
| Q5 | "Every stock with unproven tech in our universe also fails the profitability filter — already excluded. **N** stocks remain." |
| Q6 | "Here's the OC initial screen: **N** names. This matches the screen described in our FSC questionnaire — going forward you can just say 'run the initial screen'." |
| Q7 | "Daily monitoring on. I'll email you at 6am every day — change-or-no-change, your call." |
| Q8 | "**N** of your **M** sample-portfolio holdings still meet the screen. The ones that don't: …" |

| # | Assumption |
|---|---|
| 5.1 | Numbers are interpolated from the live database query at the moment the question is answered — they are not hard-coded. |
| 5.2 | "Show" renders the list in the on-screen stocks table. "Email" displays a confirmation toast in the UI ("Email queued — check your inbox"). **No email is actually sent in v2.** Q7 daily monitoring is similarly mocked. |
| 5.3 | Q5's wording is **curated narration**, not an audited claim. The underlying flag exists; the assertion that profitability subsumes it is Pep's own framing, surfaced as such. |
| 5.4 | Q6 references "page 12 of the FSC questionnaire." We display the spoken reference but do not embed the actual PDF excerpt in v2. |
| 5.5 | Q7 (daily email) is presented as a demo workflow that confirms intent. It does not start a real scheduled job. |
| 5.6 | Q8 uses the supplied 10-holding sample portfolio (see §6) and the avatar explicitly labels the answer as based on sample data. |

## 6. Sample portfolio (Q8)

The sample portfolio for Q8 is seeded with the **10 real holdings supplied** (May / Aug 2025 entry dates, weights and market values as of 31 December 2025):

| Ticker | Company | Weight % | Market Value (AUD) | First Bought | 1Y Return % | Sector |
|---|---|---:|---:|---|---:|---|
| MIN | Mineral Resources Ltd | 6.30 | 8,428,900 | 2025-05-31 | +225.67 | Basic Materials |
| CHC | Charter Hall Group | 6.24 | 8,349,675 | 2025-05-31 | +23.45 | Real Estate |
| ORI | Orica Ltd | 5.80 | 7,769,600 | 2025-05-31 | +36.61 | Basic Materials |
| VCX | Vicinity Centres | 4.66 | 6,233,600 | 2025-05-31 | +15.13 | Real Estate |
| NXT | NEXTDC Ltd | 4.59 | 6,139,700 | 2025-05-31 | +36.59 | Technology |
| REA | REA Group Ltd | 4.31 | 5,776,785 | 2025-05-31 | −27.67 | Communication Services |
| QUB | Qube Holdings Ltd | 3.92 | 5,247,000 | 2025-05-31 | +31.14 | Industrials |
| ALQ | ALS Ltd | 3.87 | 5,179,400 | 2025-05-31 | +38.10 | Industrials |
| SGH | SGH Ltd | 3.69 | 4,946,925 | 2025-08-31 | −17.67 | Industrials |
| A2M | The a2 Milk Co Ltd | 3.68 | 4,927,350 | 2025-05-31 | −9.03 | Consumer Defensive |

| # | Assumption |
|---|---|
| 6.1 | These are stored with `is_sample = true`. The avatar's Q8 answer says something like *"based on the sample portfolio you provided…"*. |
| 6.2 | Q8's overlap result will differ between the two presets. On our current snapshot: under the **Questionnaire preset**, 9 of 10 holdings meet the screen (NXT fails the profitability filter — its TTM net income is negative). Under the **Methodology preset**, the count drops further because the OC strategy excludes ASX 100 names and several of these holdings are ASX 100 by market cap. The avatar narrates this difference honestly. |
| 6.3 | If a more current real holdings list arrives before pitch finalisation, we swap it in via the upsert script — no migration required. |

## 7. What's *out* of scope for v2

| # | Assumption |
|---|---|
| 7.1 | No live ASX market-data feed (D3). |
| 7.2 | No real email delivery and no real scheduled job for Q7. The toggles are demoware. |
| 7.3 | No admin UI for editing the scripted Q&A content. The content is in code; changes go through engineering. |
| 7.4 | No periodic snapshot refresh job. The snapshot is updated only by re-running the ingest script manually. |
| 7.5 | No portfolio analytics beyond the overlap question (no risk attribution, no factor analysis). |
| 7.6 | No off-script question handling beyond a polite "I can't answer that in this demo" fallback. |

## 8. Truthfulness rules the avatar follows

| # | Assumption |
|---|---|
| 8.1 | Every stock-fact answer is labelled with the snapshot date and time. The avatar says it. |
| 8.2 | The avatar never claims an answer is "live." |
| 8.3 | Curated flags are spoken as curated, not as automatically derived. |
| 8.4 | Q7 daily monitoring is spoken as a demo action, not as a running production job. |
| 8.5 | Sample-portfolio answers are explicitly framed as sample data. |
| 8.6 | If an asked-about ticker isn't in the snapshot, the avatar says so plainly and offers to take a different name. |

## 9. Snapshot freshness handling

| # | Assumption |
|---|---|
| 9.1 | Funnel and stock-fact answers always show the snapshot's collection timestamp. |
| 9.2 | If the snapshot is older than 7 days, a yellow banner appears in the UI: *"Snapshot is X days old."* |
| 9.3 | If older than 30 days, the banner turns red. The avatar acknowledges this if asked. |

## 10. The pitch user-flow

| # | Assumption |
|---|---|
| 10.1 | The demo opens at the persona-selector screen. The user picks Generic or Custom (Pep), then clicks **Start Conversation**. |
| 10.2 | Pep delivers a brief greeting that frames the demo. |
| 10.3 | The user speaks (or types) Pep's eight supplied questions in sequence; the funnel rail and stocks table animate; the avatar narrates each step. |
| 10.4 | The user can also say *"run the OC initial screen"* to take the Methodology path. |
| 10.5 | The user can ask follow-up questions about specific stocks in the resulting shortlist (price, market cap, earnings status). |
| 10.6 | The user can ask Q7 (daily email) and Q8 (portfolio overlap) at any point after the funnel has produced a shortlist. |
| 10.7 | All speech includes a visible source label and timestamp where appropriate. |

## 11. What the demo proves

| # | Assumption |
|---|---|
| 11.1 | OC's analyst grunt-work can be productised into a repeatable, narratable workflow. |
| 11.2 | The screening engine is general — the five demo filters are exemplars, and any criterion the OC team can articulate could be slotted in. |
| 11.3 | A live ASX feed integration is a small, well-contained future addition, not a rebuild. |

## 12. Things that are still open

The following are not blockers for v2 but should be on the OC team's radar:

| # | Item | Implication |
|---|---|---|
| 12.1 | Will Pep's reference spreadsheet (defining the curated unproven-tech and single-commodity flags) arrive before pitch finalisation? | If yes, we re-seed the curated flags from it. If no, we ship with our own initial curation. |
| 12.2 | Should we display the FSC-questionnaire page-12 excerpt as an embedded PDF inside the demo when Q6 is asked? | A small UI add if the OC team wants this; not in scope for v2 unless requested. |
| 12.3 | Should the demo expose a simple "save snapshot of current shortlist" button (e.g. download CSV) to pair with the spoken "show or email" prompts? | Adds polish but isn't currently scoped. |
| 12.4 | Will Q8 ever need the **real** current OC Premium Small Company Fund holdings rather than the supplied 10 sample names? | If yes, send us the list; we re-seed via upsert in minutes. |

---

*If anything above doesn't match your expectation, or anything is missing, tell us and we'll re-lock the plan before code starts.*
