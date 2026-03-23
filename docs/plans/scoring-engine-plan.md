# Scoring Engine — Implementation Plan

**Created:** 2026-03-11
**Status:** Ready for implementation
**Sprint scope:** Sprints 1–2 from `docs/plans/poc-delivery-plan.md`

**Source documents:**
- `docs/scoring-engine-architecture.md` — Implementation spec (types, scorers, orchestrator, API)
- `docs/scoring-engine-whitepaper.md` — Research & algorithms (WSM, constraints, ML evolution, libraries)
- `docs/plans/poc-delivery-plan.md` — Overall PoC delivery plan
- `docs/poc.txt` — PoC requirements

---

## 1. Reconciliation: Architecture vs Whitepaper

The architecture doc is the implementation spec; the whitepaper is the research document. They were written at different times and have divergences that must be resolved before coding begins.

### 1.1 Resolved Agreements

Both documents agree on:
- WSM (Weighted Sum Model) for Phase 1 scoring — simple, transparent, industry-standard
- 5 scoring dimensions normalised to [0, 1]
- Pure function scorers with no I/O
- Orchestrator owns all data fetching
- Configurable weight presets
- Confidence scoring per candidate
- Data quality warnings
- No external libraries needed for PoC scoring

### 1.2 Divergences Requiring Decisions

| # | Topic | Architecture Doc | Whitepaper | Resolution |
|---|-------|-----------------|------------|------------|
| G1 | **Hard constraint filter** | Not present — goes straight to scoring | Layer 1: predicate filter chain before scoring (qualifications, schedule conflicts, availability, consecutive days, weekly hours) | **Adopt whitepaper.** Add constraint filter layer. For PoC against mock data, implement skills qualification check + schedule conflict check. Defer consecutive-days and weekly-hours until Phase 1 (need real roster data). |
| G2 | **Weight presets** | 3 presets: equal, continuity_heavy, efficiency_heavy | 5 presets: planned, urgent, high-value client, new client, efficiency | **Adopt whitepaper presets.** Replace 3 presets with whitepaper's 5. The "planned" preset maps to PoC requirements; "urgent" maps to Phase 1 cascade logic. |
| G3 | **Planned preset weights** | equal: all 0.20 | planned: skills 0.20, continuity 0.30, proximity 0.15, workload 0.20, acceptance 0.15 | **Adopt whitepaper "planned" as default.** The PoC requirements emphasise continuity of care, so a continuity-biased default is more useful for demos than equal weights. |
| G4 | **Workload scoring curve** | Gaussian: `exp(-0.5 × z²)` with asymmetric overload penalty (×1.5) | Linear: `1 - abs(current - target) / target`, clamped [0, 1] | **Keep architecture (Gaussian).** It handles edge cases better — the linear formula can go negative or exceed 1 without clamping, and doesn't naturally penalise overload more than underutilisation. The Gaussian with asymmetric penalty is more robust. |
| G5 | **Relationship normalisation** | Logarithmic: `ln(count+1)/ln(20)` × recency multiplier | Linear: `min(visits, 20) / 20` adjusted by recency and ratings | **Keep architecture (logarithmic).** Diminishing returns on visit count is realistic — the difference between 0 and 5 visits matters more than between 15 and 20. |
| G6 | **Confidence scoring** | Per-candidate: lowest dimension confidence (high/medium/low) | Per-recommendation: score distribution + data quality (top > 0.75, gap > 0.10) | **Keep both.** Architecture's per-candidate confidence stays on `ScoredCandidate`. Add whitepaper's distribution-based confidence as `match_confidence` on `MatchResult` for the overall recommendation quality. |
| G7 | **Skills as hard + soft** | Purely soft (scored 0–1) | Hard gate (must have required certs) + soft scoring (degree of fit) | **Adopt whitepaper.** Skills dimension becomes two-phase: hard filter (exclude candidates missing mandatory qualifications) then soft scoring (degree of fit for remaining candidates). This aligns with G1. |
| G8 | **Acceptance prediction evolution** | Simple ratio: `accepted / (accepted + declined)` | 4-stage progression: historical rate → segmented rates → logistic regression → XGBoost | **Architecture for PoC, whitepaper as roadmap.** PoC uses the simple ratio. Document the evolution path but don't implement ML stages yet. |
| G9 | **Explainability output** | `DimensionScore.reason` field per scorer | Natural language recommendation summary | **Architecture for PoC.** The `reason` field per dimension is the building block. Full NL summary generation is a PoC 2 / LLM task. |

### 1.3 New Items from Whitepaper (Deferred)

These whitepaper recommendations are explicitly deferred. Documented here for future reference:

| Item | Phase | Trigger |
|------|-------|---------|
| TOPSIS scoring method | Phase 2 | When WSM produces counter-intuitive rankings due to scale differences |
| AHP weight derivation UI | Phase 2+ | When admins need structured pairwise comparison for weight setting |
| PROMETHEE preference functions | Phase 3 | When domain experts confirm non-linear preferences |
| Hungarian algorithm (batch assignment) | Phase 2 | When optimising full schedules, not single shifts |
| Stable matching (Gale-Shapley) | Future | If marketplace model where caregivers express preferences |
| Logistic regression for acceptance | Phase 1 late | When 200+ offer data points accumulate |
| XGBoost via ONNX | Phase 2 | When 1000+ offer data points; Python training pipeline needed |
| ILP solver (glpk.js / yalps) | Phase 3 | When batch weekly scheduling is built |

---

## 2. Updated Type Definitions

Based on reconciliation decisions, the following changes to the architecture doc's types:

### 2.1 New: `HardConstraintResult`

```typescript
export interface HardConstraintResult {
  eligible: boolean;
  failed_constraints: string[];  // e.g. ["Missing required qualification: Manual Handling"]
}
```

### 2.2 Core Types (from architecture doc, reproduced here for implementor reference)

These types are defined in `docs/scoring-engine-architecture.md` and must be created in `types.ts`:

```typescript
export interface WeightConfig {
  skills: number;
  relationship: number;
  proximity: number;
  workload: number;
  acceptance: number;
}

export interface DimensionScore {
  score: number;                              // 0–1 normalised
  confidence: "high" | "medium" | "low";
  reason: string;                             // Human-readable explanation
}

export interface DimensionBreakdown {
  skills: DimensionScore;
  relationship: DimensionScore;
  proximity: DimensionScore;
  workload: DimensionScore;
  acceptance: DimensionScore;
}

export interface ScoredCandidate {
  employee_id: number;
  employee_name: string;
  overall: number;                            // 0–1 weighted composite
  confidence: "high" | "medium" | "low";      // Lowest dimension confidence
  dimensions: DimensionBreakdown;
  warnings: string[];                         // Per-candidate data quality warnings
}
```

`WeightConfig` — 5 dimensions, must sum to 1.0.

### 2.3 Updated: Weight Presets (G2, G3)

```typescript
export const WEIGHT_PRESETS = {
  /** Planned shifts — continuity + workload balance prioritised */
  planned: {
    skills: 0.20, relationship: 0.30, proximity: 0.15, workload: 0.20, acceptance: 0.15,
  },
  /** Urgent shifts — acceptance + proximity prioritised */
  urgent: {
    skills: 0.15, relationship: 0.10, proximity: 0.25, workload: 0.10, acceptance: 0.40,
  },
  /** High-value clients — proven track record prioritised */
  high_value_client: {
    skills: 0.15, relationship: 0.35, proximity: 0.15, workload: 0.10, acceptance: 0.25,
  },
  /** New clients — experienced caregivers prioritised */
  new_client: {
    skills: 0.25, relationship: 0.05, proximity: 0.20, workload: 0.25, acceptance: 0.25,
  },
  /** Efficiency — proximity + workload balance prioritised */
  efficiency: {
    skills: 0.15, relationship: 0.10, proximity: 0.30, workload: 0.30, acceptance: 0.15,
  },
} as const;

export const DEFAULT_PRESET = "planned";
```

### 2.4 Updated: `MatchResult` (G6)

Add `match_confidence` alongside existing fields:

```typescript
export interface MatchResult {
  visit_id: number;
  client_id: number;
  candidates: ScoredCandidate[];
  weights_used: WeightConfig;
  preset_name: string | null;
  candidate_pool_size: number;
  eligible_pool_size: number;           // NEW: after hard constraint filtering
  data_warnings: string[];
  match_confidence: "high" | "medium" | "low";  // NEW: distribution-based (G6)
  scored_at: string;
}
```

`match_confidence` logic:
- **High**: top candidate > 0.75 AND gap to #2 > 0.10 AND all dimensions have data
- **Medium**: top candidate 0.50–0.75 OR gap < 0.10 OR 1+ dimension incomplete
- **Low**: top candidate < 0.50 OR 2+ dimensions incomplete OR fewer than 3 eligible

### 2.5 Updated: Zod Schema

```typescript
const MatchRequestSchema = z.object({
  weights: z.object({ ... }).refine(sumsToOne).optional(),
  preset: z.enum(["planned", "urgent", "high_value_client", "new_client", "efficiency"]).optional(),
  limit: z.number().int().min(1).max(50).optional(),
}).refine(d => !(d.weights && d.preset), "Provide either weights or preset, not both");
```

---

## 3. Updated Architecture Flow

```
POST /api/v1/visits/[id]/match
         │
         ▼
  ┌─────────────────────────────────────────────┐
  │  Match Route (Transport Layer)               │
  │  traceId → requireAuthContext → computeMatch │
  └──────────────────┬──────────────────────────┘
                     │
                     ▼
  ┌─────────────────────────────────────────────┐
  │  computeMatch() — Orchestrator               │
  │                                               │
  │  ── Phase 1: Bulk Data Fetch ──               │
  │  1. Fetch visit details + client              │
  │  2. Fetch active employee pool (list)         │
  │  3. Fetch all employee skills (batch/list)    │
  │  4. Fetch employee schedules for target       │
  │     date (batch: visits?date=YYYY-MM-DD)      │
  │  5. Fetch visit history for client            │
  │     (batch: visits?client_id=X)               │
  │  6. Fetch visit offers for client's visits    │
  │     (batch: visit_offers?visit_id=...)        │
  │  Steps 3–6 run in parallel via Promise.all    │
  │                                               │
  │  ── Phase 2: Hard Constraint Filter ──        │
  │  7. Filter: has required qualifications?      │
  │  8. Filter: qualifications not expired?       │
  │  9. Filter: no schedule conflict? (uses       │
  │     step 4 schedule data, interval overlap)   │
  │ 10. Record eligible_pool_size                 │
  │                                               │
  │  ── Phase 3: Multi-Factor Scoring (WSM) ──    │
  │ 11. Compute pool statistics (mean/stddev)     │
  │ 12. For each eligible employee:               │
  │     ├── Run 5 dimension scorers (pure,        │
  │     │   using pre-fetched data from Phase 1)  │
  │     ├── Apply weight config                   │
  │     └── Compute overall score                 │
  │                                               │
  │  ── Phase 4: Ranking + Confidence ──          │
  │ 13. Sort by overall score descending          │
  │ 14. Take top N                                │
  │ 15. Compute match_confidence                  │
  │ 16. Collect data quality warnings             │
  └─────────────────────────────────────────────┘
```

---

## 4. File Structure (Updated)

```
src/
  services/
    scoring/
      types.ts                 # All type definitions (including HardConstraintResult)
      weights.ts               # 5 weight presets + validation
      constraints.ts           # Hard constraint filter predicates (G1, G7)
      score-skills.ts          # Dimension 1: Skills & qualifications (soft scoring)
      score-relationship.ts    # Dimension 2: Client relationship history
      score-proximity.ts       # Dimension 3: Geographic proximity
      score-workload.ts        # Dimension 4: Workload balance
      score-acceptance.ts      # Dimension 5: Acceptance likelihood
      match-confidence.ts      # Distribution-based match confidence (G6)
      compute-match.ts         # Orchestrator: filter → score → rank
      index.ts                 # Public API barrel export

app/
  api/v1/
    visits/
      [id]/
        match/
          route.ts             # POST endpoint

src/
  hooks/
    use-match.ts               # TanStack Query hook
```

---

## 5. Implementation Tasks

### Sprint 1: Scoring Algorithm Core (3–4 days)

All tasks follow TDD: write failing test → implement → refactor.

#### Task 1.0: Types & Weight Presets (0.5 day)
- [x] Create `src/services/scoring/types.ts` with all interfaces
- [x] Create `src/services/scoring/weights.ts` with 5 presets
- [x] Unit test: weight presets all sum to 1.0
- [x] Unit test: `DEFAULT_PRESET` is "planned"

#### Task 1.1: Hard Constraint Filter (0.5 day)
- [x] Create `src/services/scoring/constraints.ts`
- [x] `checkHardConstraints(employee, employeeSkills, employeeSchedule, visit, now)` → `HardConstraintResult`
- [x] Predicate: `hasRequiredQualifications` — set intersection of employee skills vs visit requirements
- [x] Predicate: `qualificationsNotExpired` — date check against `now`
- [x] Predicate: `noScheduleConflict` — check if any existing visit in `employeeSchedule` overlaps the target visit's `[start_at, end_at]` interval. Data comes from orchestrator's bulk fetch (Phase 1, step 4).
- [x] Unit tests: eligible employee passes, missing qual fails, expired qual fails, conflict fails
- [x] Edge case: no required qualifications → all eligible
- [x] Edge case: empty schedule → no conflict

#### Task 1.2: Skills Match Scorer (0.5 day)
- [x] Create `src/services/scoring/score-skills.ts`
- [x] Pure function: `scoreSkills(employeeSkills, requiredSkills, now)` → `DimensionScore`
- [x] Algorithm: `valid_matched / required_count` (per architecture doc)
- [x] Only scores *soft* fit — hard filter already removed unqualified candidates
- [x] Unit tests: full match, partial match, no match, expired skill, no requirements (→ 1.0 low confidence)

#### Task 1.3: Relationship History Scorer (0.5 day)
- [x] Create `src/services/scoring/score-relationship.ts`
- [x] Pure function: `scoreRelationship(priorVisits)` → `DimensionScore`
- [x] Algorithm: logarithmic `ln(count+1)/ln(20)` × recency multiplier (per architecture doc, decision G5)
- [x] Recency: ≤7d → 1.0, ≤30d → 0.8, ≤90d → 0.6, older → 0.4
- [x] Unit tests: 0 visits, 1 visit, 10 visits, 19+ visits, recent vs stale

#### Task 1.4: Geographic Proximity Scorer (0.5 day)
- [x] Create `src/services/scoring/score-proximity.ts`
- [x] Pure function: `scoreProximity(empLat, empLng, clientLat, clientLng)` → `DimensionScore`
- [x] Algorithm: Haversine distance, linear decay `max(0, 1 - d/50)`
- [x] Unit tests: same location (→ 1.0), 25km (→ 0.5), 50km+ (→ 0.0), null coords (→ 0.0 low confidence)

#### Task 1.5: Workload Balance Scorer (0.5 day)
- [x] Create `src/services/scoring/score-workload.ts`
- [x] Pure function: `scoreWorkload(empCount, poolMean, poolStddev)` → `DimensionScore`
- [x] Algorithm: Gaussian `exp(-0.5 × z²)` with 1.5× overload penalty (per architecture doc, decision G4)
- [x] Unit tests: at mean (→ 1.0), 1σ above (penalised), 1σ below, stddev=0 (→ 1.0 for all)

#### Task 1.6: Acceptance Likelihood Scorer (0.5 day)
- [x] Create `src/services/scoring/score-acceptance.ts`
- [x] Pure function: `scoreAcceptance(offers)` → `DimensionScore`
- [x] Algorithm: `accepted / (accepted + declined)`, ignore pending
- [x] Confidence: <3 offers → low, 3–9 → medium, 10+ → high
- [x] Unit tests: no history (→ 0.5 low), all accepted (→ 1.0), all declined (→ 0.0), mixed

#### Task 1.7: Match Confidence Calculator (0.25 day)
- [x] Create `src/services/scoring/match-confidence.ts`
- [x] `computeMatchConfidence(candidates)` → `"high" | "medium" | "low"`
- [x] Logic per decision G6 (top score, gap to #2, data completeness)
- [x] Unit tests: clear winner → high, tight race → medium, low scores → low, few candidates → low

#### Task 1.8: Orchestrator (0.75 day)
- [x] Create `src/services/scoring/compute-match.ts`
- [x] `computeMatch(visitId, config)` → `MatchResult`
- [x] **Phase 1 — Bulk data fetch** (minimise API calls, avoid N+1):
  - Fetch visit details + client via `alayaFetch`
  - Fetch active employee pool (single list call)
  - `Promise.all` for parallel batch fetches: employee skills, employee schedules for target date, client visit history, visit offers
  - Build in-memory lookup maps: `skillsByEmployeeId`, `schedulesByEmployeeId`, `visitsByEmployeeId`, `offersByEmployeeId`
- [x] **Phase 2 — Hard constraint filter** (G1): iterate employees against lookup maps → eligible pool
- [x] **Phase 3 — Scoring**: compute pool statistics (mean/stddev) → run 5 pure scorers per eligible employee using pre-fetched data → weighted sum
- [x] **Phase 4 — Ranking**: sort, limit, compute `match_confidence`, collect warnings
- [x] **Mocking strategy:** Use `vi.mock("@/src/lib/alayacare-client")` to mock `alayaFetch` at module level. Each test provides mock return values per endpoint path. This matches PoC simplicity — DI approach deferred to production if needed.
- [x] Unit tests (with mocked `alayaFetch`): correct ranking, weight application, limit enforcement, warning collection, AlayaCare API error → thrown Error, empty pool → low confidence

#### Task 1.9: Barrel Export (0.1 day)
- [x] Create `src/services/scoring/index.ts` — export `computeMatch`, types, weight presets

**Sprint 1 Status: COMPLETE** (2026-03-11) — 11 implementation files, 9 test files, 61 tests passing, `tsc --noEmit` clean.

**Sprint 1 Deliverables:**
- 11 files in `src/services/scoring/` (10 modules + barrel)
- 9 co-located test files
- All scorers tested in isolation + orchestrator tested with mocked I/O

---

### Sprint 2: Match Endpoint & Data Validation (2–3 days)

#### Task 2.1: Match API Endpoint (0.5 day)
- [x] Create `app/api/v1/visits/[id]/match/route.ts`
- [x] POST handler: traceId → requireAuthContext → parse Zod schema → computeMatch → Response.json
- [x] **Route pattern note:** This route calls `computeMatch` directly (no `makeDeps()`/UoW) because scoring is pure computation over AlayaCare data — no DB writes needed. This matches the existing AlayaCare passthrough pattern in `app/api/v1/visits/route.ts`. Add a comment in the route file explaining this.
- [x] Zod schema: `MatchRequestSchema` with preset enum (5 values), optional weights, optional limit. **Zod v4 note:** `.refine()` works but produces different error paths — add a specific test for the mutual exclusion refinement (`weights` + `preset` both provided → 400) to verify error shape matches `handleAppError` expectations.
- [x] **AlayaCare error mapping:** `alayaFetch` throws generic `Error` on non-200 responses, which `handleAppError` maps to 500. To surface 502 for AlayaCare failures: add `ExternalServiceError` class to `src/server/errors.ts` (extends `AppError`, status 502). Wrap `computeMatch` call in try/catch: if error message starts with `"AlayaCare API error"`, rethrow as `ExternalServiceError`.
- [x] Error responses: 400 (validation), 401 (auth), 404 (visit not found), 502 (AlayaCare API error via `ExternalServiceError`)
- [x] Integration test: valid request → MatchResult shape, auth required, bad input → 400, mutual exclusion → 400

#### Task 2.2: API Rewrite Verification (0.1 day)
- [x] Verify that the existing rewrite `{ source: "/api/visits/:path*", destination: "/api/v1/visits/:path*" }` in `next.config.ts` covers `/api/visits/123/match` (`:path*` is greedy — it should). If not, add an explicit entry. **Note:** `next.config.ts` uses per-resource explicit rewrites, not a catch-all.

#### Task 2.3: Client Hook (0.25 day)
- [x] Create `src/hooks/use-match.ts`
- [x] `useMatch(visitId, options?)` — TanStack Query wrapper around `apiFetch`
- [x] Options: preset, weights, limit, enabled

#### Task 2.4: Match Results UI (1–1.5 days)
- [x] Create match results component showing:
  - Ranked candidates with overall score
  - Per-dimension breakdown (5 bars/chips with scores)
  - Confidence indicator (high/medium/low)
  - Data quality warnings per candidate
  - Global data warnings
  - Weight preset selector
- [x] Wire to visit detail page or standalone `/visits/[id]/match` page
- [x] Loading/error states

#### Task 2.5: Data Completeness Validation (0.5 day)
- [x] Enhance orchestrator warning collection:
  - Count employees missing coordinates
  - Count employees with no skills on file
  - Flag when visit has no required skills defined
  - Flag when visit has no client_id
- [x] Display global warnings prominently in UI

#### Task 2.6: Documentation Update (0.25 day)
- [x] Update CLAUDE.md and features.md with Sprint 2 additions
- [x] Mark Sprint 2 tasks complete in plan

**Sprint 2 Status: COMPLETE** (2026-03-11) — Match endpoint, client hook, UI component, ExternalServiceError, data completeness warnings, quality review fixes.

**Sprint 2 Deliverables:**
- Working match endpoint returning scored candidates (12 tests)
- Client hook + UI showing results (6 tests)
- Data quality warnings visible (enhanced with no-client and no-skills-on-file warnings)
- Updated documentation

---

## 6. Testing Strategy

### Unit Tests (Sprint 1)

| File | Test Count (est.) | Key Scenarios |
|------|------------------|---------------|
| `constraints.test.ts` | 9 | Eligible, missing qual, expired qual, conflict, no requirements, empty schedule |
| `score-skills.test.ts` | 6 | Full/partial/no match, expired, no requirements |
| `score-relationship.test.ts` | 6 | 0/1/10/19+ visits, recent vs stale |
| `score-proximity.test.ts` | 5 | Same location, mid-range, max range, null coords |
| `score-workload.test.ts` | 5 | At mean, above, below, zero stddev, zero shifts |
| `score-acceptance.test.ts` | 6 | No history, all accept, all decline, mixed, low sample |
| `match-confidence.test.ts` | 4 | Clear winner, tight race, low scores, few candidates |
| `weights.test.ts` | 3 | Presets sum to 1.0, default preset |
| `compute-match.test.ts` | 8 | Ranking, weights, limit, warnings, API error, empty pool |
| **Total** | **~52** | |

### Integration Tests (Sprint 2)

| File | Test Count (est.) | Key Scenarios |
|------|------------------|---------------|
| `match-endpoint.test.ts` | 8 | Valid request, auth, bad input, preset vs weights mutual exclusion (Zod v4 refine), visit not found, AlayaCare 502 mapping |
| **Total** | **~8** | |

---

## 7. Mock Data Requirements

The scoring engine runs against mock-alaya. These mock data scenarios must exist:

| Scenario | Purpose |
|----------|---------|
| Employee with all required skills (current) | Skills scorer: full match |
| Employee with partial skills + 1 expired | Skills scorer: partial match + warning |
| Employee with 0 skills on file | Skills scorer: 0 score + warning |
| Employee with 15+ visits to client (recent) | Relationship: high score |
| Employee with 0 visits to client | Relationship: 0 score |
| Employee with stale history (90+ days) | Relationship: recency penalty |
| Employee with valid coordinates near client | Proximity: high score |
| Employee with null coordinates | Proximity: 0 + low confidence warning |
| Employees with varied shift counts | Workload: distribution testing |
| Employee with 20+ accepted offers | Acceptance: high score, high confidence |
| Employee with 2 offers total | Acceptance: low confidence |
| Employee with schedule conflict | Hard constraint: filtered out |
| Employee with expired mandatory qualification | Hard constraint: filtered out |
| Visit with no required skills defined | Edge case: skills → 1.0 for all |
| Client with no coordinates | Edge case: proximity unavailable for all |

---

## 8. Dependencies

### Existing (Available Now)
- `src/lib/alayacare-client.ts` — `alayaFetch<T>(path, options?)` for all AlayaCare API calls (Basic auth via env vars, throws `Error` on non-200)
- `src/hooks/use-employees.ts`, `use-visits.ts`, `use-alaya-clients.ts` — data hooks
- `src/hooks/use-skills.ts` — skills data
- mock-alaya server running at https://mock-alaya.vercel.app
- Auth infrastructure (`requireAuthContext`, `handleAppError`, traceId)

### Not Yet Available
- Visit offer data from mock-alaya (need to verify `GET /ext/api/v2/scheduler/visit_offers` endpoint exists)
- Employee skills with expiry dates (verify mock data structure)
- Client required qualifications (verify mock data includes `required_skill_ids` or equivalent)

### Pre-Sprint Gate (MUST PASS before Sprint 1 begins)

Sprint 1 is **blocked** until all checks below pass. Run these against mock-alaya at https://mock-alaya.vercel.app:

| # | Check | Endpoint | Required Fields | Blocks Tasks |
|---|-------|----------|-----------------|--------------|
| G1 | Employee skills with expiry | `GET /ext/api/v2/employees/{id}/skills` | `skill_id`, `expired_date` (some null, some past, some future) | 1.1, 1.2 |
| G2 | Visit offers (accept/decline) | `GET /ext/api/v2/scheduler/visit_offers` | `employee_id`, `status` (`accepted`/`declined`/`pending`) | 1.6 |
| G3 | Client required qualifications | `GET /ext/api/v2/clients/{id}` or visit payload | `required_skill_ids` or equivalent array | 1.1, 1.2 |
| G4 | Employee coordinates | `GET /ext/api/v2/employees` list | `latitude`, `longitude` (some null for testing) | 1.4 |
| G5 | Employee schedule for conflict | `GET /ext/api/v2/scheduler/visits?employee_id={id}` | `start_at`, `end_at`, `employee_id` | 1.1 |
| G6 | Client visit history per employee | `GET /ext/api/v2/scheduler/visits?client_id={id}` | `employee_id`, `start_at` for recency calc | 1.3 |

**If any check fails:** Add missing mock-alaya endpoints or data before proceeding. Estimate 0.5–1 day per missing endpoint.

---

## 9. Acceptance Criteria

### Sprint 1 Complete When:
- All 5 scorers implemented with passing unit tests
- Hard constraint filter implemented with passing unit tests
- Orchestrator assembles results correctly (mocked I/O tests pass)
- ~52 unit tests passing
- `npx tsc --noEmit` clean

### Sprint 2 Complete When:
- `POST /api/v1/visits/[id]/match` returns valid `MatchResult`
- Auth enforced (401 without session)
- Zod validation works (400 on bad input, mutual exclusion of weights/preset returns 400)
- AlayaCare failures return 502 (not generic 500)
- 5 weight presets selectable
- Match results visible in UI with dimension breakdown
- Data quality warnings displayed
- ~60 total tests passing (52 unit + 8 integration)
- Requirements R2.1–R2.8 marked DONE in traceability

---

## 10. Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Mock-alaya missing required endpoints (offers, skills) | Medium | High | Verify before Sprint 1; add mock endpoints if needed |
| AlayaCare data shapes differ from assumptions | Medium | Medium | Type definitions act as contract; update when sandbox access arrives |
| Scoring produces unintuitive rankings | Low | Medium | Configurable weights; iterate with domain experts; whitepaper gives alternative algorithms |
| Orchestrator too slow with many employees | Low | Low | Mock data is fast; real performance optimisation deferred to production |
