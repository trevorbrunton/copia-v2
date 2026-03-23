# Scoring Engine Architecture

Architecture for the caregiver match-scoring engine that powers PoC 1 (R2.1–R2.9). This is a **pure algorithmic system** — no LLM involved. The LLM consumes scoring output in PoC 2.

**Reference documents:**
- Requirements: `docs/poc.txt` (Scoring Dimensions Prototype section)
- Traceability: `docs/poc-traceability.md` (R2.1–R2.9)
- Delivery plan: `docs/plans/poc-delivery-plan.md` (Sprints 1–2)
- Implementation plan: `docs/plans/scoring-engine-plan.md` (reconciled decisions, task breakdown)
- Research whitepaper: `docs/scoring-engine-whitepaper.md` (algorithm options, ML evolution, libraries)
- Main architecture: `docs/ARCHITECTURE.md`

---

## Design Rationale

### Why Algorithmic, Not LLM

All 5 scoring dimensions are **quantifiable calculations**, not judgement calls:

| Dimension | Calculation Type | Example |
|-----------|-----------------|---------|
| Skills match | Set intersection + expiry check | "Employee has 4 of 5 required skills, 1 expired" |
| Relationship history | Count + recency | "12 prior visits with this client, last one 3 days ago" |
| Geographic proximity | Haversine distance | "7.2km away" |
| Workload balance | Count normalisation | "18 shifts this fortnight vs pool average of 14" |
| Acceptance likelihood | Ratio from history | "Accepts 78% of evening shift offers" |

An LLM would be slower (~1–3s vs <50ms), non-deterministic, and more expensive for the same result.

### Separation of Concerns

```
PoC 1 (this doc)              PoC 2 (future)
─────────────────             ──────────────
Pure scoring algorithm   →    LLM reasoning layer
Deterministic numbers    →    Contextual interpretation
"Sarah scores 0.82"     →    "Sarah is recommended because..."
                         →    Escalation decisions
                         →    Trade-off reasoning
```

The scoring engine produces structured data (`MatchResult`). PoC 2's LLM receives that data as prompt context and reasons about trade-offs, edge cases, and escalation decisions that can't be reduced to a formula.

---

## Architecture Overview

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
  │  Phase 1: Bulk Data Fetch                      │
  │  1. Fetch visit details                        │
  │  2. Fetch client + employees + history (||)    │
  │     └── employees filtered status=active       │
  │                                                │
  │  Phase 2: Hard Constraint Filter (3-step)      │
  │  3a. Filter by schedule conflicts (free)       │
  │  3b. Fetch skills for eligible only (parallel) │
  │  3c. Filter by skill qualifications            │
  │                                                │
  │  Phase 3: Multi-Factor Scoring                 │
  │  4. Run 5 dimension scorers per candidate      │
  │  5. Apply weight config, compute overall       │
  │                                                │
  │  Phase 4: Ranking + Confidence                 │
  │  6. Sort by overall score descending           │
  │  7. Return top N with data quality warnings    │
  │  8. Carry fetchedVisit + fetchedClient on      │
  │     MatchResult for downstream reuse           │
  └──────────────────┬──────────────────────────┘
                     │
         ┌───────────┼───────────┐
         ▼           ▼           ▼
  ┌──────────┐ ┌──────────┐ ┌──────────┐
  │ scoreSkills│ │ scoreProx│ │ scoreAccept│  ... (5 pure functions)
  │  (data)→0-1│ │ (data)→0-1│ │ (data)→0-1│
  └──────────┘ └──────────┘ └──────────┘
```

### Key Architectural Decisions

| ID | Decision | Rationale |
|----|----------|-----------|
| S1 | **Scorers are pure functions** | Receive pre-fetched data, return a number. No I/O, no side effects. Trivially testable. |
| S2 | **Orchestrator owns all data fetching** | Single place to optimise queries, add caching, handle AlayaCare API errors. Scorers never call `alayaFetch`. |
| S3 | **Scores normalised to 0–1** | Composable via weighted sum. Overall score is naturally 0–1 when weights sum to 1. |
| S4 | **Graceful degradation for missing data** | Null coordinates → score 0 + `confidence: "low"` + warning. Never crashes, always produces a result. |
| S5 | **Server-side only** | Scoring runs on the server. The match endpoint is an API route, not a client-side computation. Keeps AlayaCare credentials server-side. |
| S6 | **No database required** | All data fetched from AlayaCare API via `alayaFetch`. No local tables for scoring. This changes in Phase 1 when we add caching and audit logging. |
| S8 | **Cached employee roster** | Employee list + skills bulk-fetched once via `AlayaCareCache` (30s TTL with stampede prevention). First call in a burst warms cache; subsequent calls hit cache. Eliminates N+1 per-employee skills API calls. |
| S9 | **Data passthrough on MatchResult** | `fetchedVisit` and `fetchedClient` carried on result to avoid re-fetching in downstream consumers (e.g., `buildRecommendationContext`). |
| S7 | **Weight presets, not just raw numbers** | Named strategies (equal, continuity-heavy, efficiency-heavy) are easier to communicate to stakeholders and select in UI. Custom weights still supported. |

---

## File Structure

```
src/
  services/
    scoring/
      types.ts                 # All type definitions (incl. FetchedVisitDetail, FetchedClientDetail)
      weights.ts               # Weight presets and validation
      constraints.ts           # Hard constraint filters (schedule conflicts + skill qualifications)
      score-skills.ts          # Dimension 1: Skills & qualifications match
      score-relationship.ts    # Dimension 2: Client relationship history
      score-proximity.ts       # Dimension 3: Geographic proximity
      score-workload.ts        # Dimension 4: Workload balance
      score-acceptance.ts      # Dimension 5: Acceptance likelihood
      compute-match.ts         # Orchestrator: fetch data, run scorers, rank results
      index.ts                 # Public API barrel export

app/
  api/v1/
    visits/
      [id]/
        match/
          route.ts             # POST endpoint

src/
  hooks/
    use-match.ts               # TanStack Query hook for match results
```

---

## Type Definitions

### Core Types (`src/services/scoring/types.ts`)

```typescript
/** Score for a single dimension (0–1 normalised) */
export interface DimensionScore {
  score: number;                              // 0–1
  confidence: "high" | "medium" | "low";
  reason: string;                             // Human-readable, e.g. "7.2km away"
}

/** All 5 dimension scores for one candidate */
export interface DimensionBreakdown {
  skills: DimensionScore;
  relationship: DimensionScore;
  proximity: DimensionScore;
  workload: DimensionScore;
  acceptance: DimensionScore;
}

/** A scored caregiver candidate */
export interface ScoredCandidate {
  employee_id: number;
  employee_name: string;
  overall: number;                            // 0–1 weighted composite
  confidence: "high" | "medium" | "low";      // Lowest confidence across dimensions
  dimensions: DimensionBreakdown;
  warnings: string[];                         // Data quality issues for this candidate
}

/** Weights for each dimension (must sum to 1.0) */
export interface WeightConfig {
  skills: number;
  relationship: number;
  proximity: number;
  workload: number;
  acceptance: number;
}

/** Input to the match endpoint */
export interface MatchRequest {
  weights?: WeightConfig;                     // Custom weights (optional, defaults to planned)
  preset?: "planned" | "urgent" | "high_value_client" | "new_client" | "efficiency";  // Named preset (optional)
  limit?: number;                             // Max candidates to return (default: 10)
}

/** Output from the match endpoint */
export interface MatchResult {
  visit_id: number;
  client_id: number | null;                   // Null if visit has no client assigned
  candidates: ScoredCandidate[];              // Ranked by overall score descending
  weights_used: WeightConfig;
  preset_name: string | null;
  candidate_pool_size: number;                // Total active employees considered
  eligible_pool_size: number;                 // Employees passing hard constraints
  data_warnings: string[];                    // Global warnings (e.g. "12 employees missing coordinates")
  match_confidence: "high" | "medium" | "low"; // Distribution-based overall confidence
  scored_at: string;                          // ISO timestamp
  fetchedVisit?: FetchedVisitDetail;          // Pre-fetched visit (avoids re-fetch downstream)
  fetchedClient?: FetchedClientDetail;        // Pre-fetched client (avoids re-fetch downstream)
}
```

### Weight Presets (`src/services/scoring/weights.ts`)

```typescript
export const WEIGHT_PRESETS = {
  /** Planned shifts — continuity + workload balance prioritised */
  planned: {
    skills: 0.20,
    relationship: 0.30,
    proximity: 0.15,
    workload: 0.20,
    acceptance: 0.15,
  },
  /** Urgent shifts — acceptance + proximity prioritised */
  urgent: {
    skills: 0.15,
    relationship: 0.10,
    proximity: 0.25,
    workload: 0.10,
    acceptance: 0.40,
  },
  /** High-value clients — proven track record prioritised */
  high_value_client: {
    skills: 0.15,
    relationship: 0.35,
    proximity: 0.15,
    workload: 0.10,
    acceptance: 0.25,
  },
  /** New clients — experienced caregivers prioritised */
  new_client: {
    skills: 0.25,
    relationship: 0.05,
    proximity: 0.20,
    workload: 0.25,
    acceptance: 0.25,
  },
  /** Efficiency — proximity + workload balance prioritised */
  efficiency: {
    skills: 0.15,
    relationship: 0.10,
    proximity: 0.30,
    workload: 0.30,
    acceptance: 0.15,
  },
} as const satisfies Record<string, WeightConfig>;

export const DEFAULT_PRESET: PresetName = "planned";
```

---

## Dimension Scorers

Each scorer is a **pure function** that receives pre-fetched data and returns a `DimensionScore`. No I/O, no side effects.

### 1. Skills Match (`score-skills.ts`)

**Input:** Employee's skills list, required skill IDs for the visit/client, current date.

**Algorithm:**
1. Find intersection of employee skills and required skills
2. Check each matched skill for expiry (`expired_date < now` → don't count)
3. Score = (valid matched skills) / (total required skills)
4. If no required skills defined, return score 1.0 with confidence "low" (no signal)

**Edge cases:**
- Employee has no skills recorded → score 0, confidence "low", warning "No skills on file"
- Required skill expired → partial match, warning "Skill X expired on Y"
- No required skills for visit → score 1.0, confidence "low", reason "No specific skills required"

```
Score formula: valid_matches / required_count
Range: 0 (no match) to 1 (all skills matched and current)
```

### 2. Relationship History (`score-relationship.ts`)

**Input:** List of historical visits for this employee↔client pair.

**Algorithm:**
1. Count total prior visits between this employee and client
2. Calculate recency bonus: days since most recent visit (more recent = higher bonus)
3. Combine: base score from visit count (logarithmic scale) + recency multiplier
4. If no prior visits, return score 0 with confidence "low" (insufficient data to assess relationship)

**Scoring curve:**
```
visit_count_score = min(1.0, ln(visit_count + 1) / ln(20))
  → 0 visits = 0.0
  → 1 visit  = 0.23
  → 5 visits = 0.58
  → 10 visits = 0.77
  → 19+ visits = 1.0

recency_multiplier:
  → within 7 days  = 1.0
  → within 30 days = 0.8
  → within 90 days = 0.6
  → older          = 0.4

final_score = visit_count_score × recency_multiplier
```

### 3. Geographic Proximity (`score-proximity.ts`)

**Input:** Employee lat/lng, client lat/lng.

**Algorithm:**
1. If either coordinate pair is null → score 0, confidence "low", warning "Missing coordinates"
2. Calculate Haversine distance in kilometres
3. Linear decay from 1.0 (0km) to 0.0 (50km+)

```
Haversine formula:
  a = sin²(Δlat/2) + cos(lat1) × cos(lat2) × sin²(Δlng/2)
  c = 2 × atan2(√a, √(1−a))
  d = R × c  (R = 6371km)

Score formula: max(0, 1 − distance_km / MAX_DISTANCE_KM)
  MAX_DISTANCE_KM = 50 (configurable)

Range: 0 (50+ km away) to 1 (same location)
```

### 4. Workload Balance (`score-workload.ts`)

**Input:** Employee's visit count in the scoring period, pool average visit count, pool standard deviation.

**Algorithm:**
1. Calculate how many standard deviations the employee is from the pool mean
2. Employees near the mean score highest (balanced workload)
3. Overloaded employees (high shift count) penalised more than underutilised

```
z_score = (employee_count - pool_mean) / pool_stddev
score = exp(-0.5 × z_score²)  (Gaussian centred on the mean)

Asymmetric penalty: if z_score > 0 (overloaded), multiply penalty by 1.5

Range: 0 (extreme outlier) to 1 (exactly at pool average)
```

**Edge cases:**
- Pool stddev = 0 (all employees have same count) → score 1.0 for all
- Employee has 0 shifts → score based on distance from mean (may score high if pool is overloaded)
- Scoring period: rolling 14-day window (configurable)

### 5. Acceptance Likelihood (`score-acceptance.ts`)

**Input:** Employee's historical offer records (all offers, not just for this visit), plus optional DappaAi contact outcomes.

**Algorithm:**
1. Count accepted, declined, and pending offers from AlayaCare history
2. Score = accepted / (accepted + declined) — ignore pending
3. If fewer than 3 historical offers → confidence "low" (insufficient data)

**DappaAi outcome merging (Phase 1):** When `dappaAiOutcomes` are provided, they are merged with AlayaCare offer history using exponential decay weighting (30-day half-life). Recent DappaAi data is weighted higher than older AlayaCare data, creating a feedback loop from the autonomous rostering system.

```
Score formula: accepted_count / (accepted_count + declined_count)
Minimum sample: 3 offers for "medium" confidence, 10+ for "high"

Range: 0 (always declines) to 1 (always accepts)
```

**Edge cases:**
- No offer history → score 0.5 (neutral prior), confidence "low"
- Only pending offers → score 0.5 (no signal), confidence "low"
- All declined → score 0, confidence based on sample size

---

## Orchestrator (`compute-match.ts`)

The orchestrator is the **only module that performs I/O**. It fetches data from AlayaCare, distributes it to pure scorers, and assembles the result.

### Data Flow

```
computeMatch(visitId, config)
  │
  ├── Phase 1: Bulk Data Fetch
  │   ├── fetchVisit(visitId)                         → Visit
  │   └── Promise.all:
  │       ├── fetchClient(visit.client_id)            → AlayaClient
  │       ├── fetchEmployees(status=active)            → Employee[]
  │       ├── fetchSchedule(date)                      → ScheduleVisit[]
  │       ├── fetchClientHistory(client_id)            → VisitHistory[]
  │       └── fetchOffers(client_id)                   → Offer[]
  │
  ├── Phase 2: Hard Constraint Filter (3-step)
  │   ├── 2a. Filter by schedule conflicts (free — uses cached data)
  │   ├── 2b. Skills already bulk-fetched via cached employee roster
  │   │       └── No per-employee API calls — skills cached alongside employees
  │   └── 2c. Filter by skill qualifications
  │
  ├── Phase 3: Multi-Factor Scoring
  │   ├── Compute pool statistics (mean/stddev of shift counts)
  │   └── For each eligible employee:
  │       ├── scoreSkills, scoreRelationship, scoreProximity
  │       ├── scoreWorkload, scoreAcceptance
  │       └── computeOverall(dimensions, weights)
  │
  └── Phase 4: Ranking + Confidence
      ├── Sort by overall score descending
      ├── Take top N, collect data quality warnings
      └── Carry fetchedVisit + fetchedClient on MatchResult
```

### Data Fetching Strategy

**Batch approach** — minimise AlayaCare API calls:

| Data | Fetch strategy | API calls |
|------|---------------|-----------|
| Visit details | Single fetch by ID | 1 |
| Client details | Single fetch by ID (skipped if no client) | 0–1 |
| Active employees | Single paginated fetch with `status=active` | 1 |
| Day's schedule | Single fetch filtered by date | 1 |
| Visit history | Single fetch filtered by `client_id` | 0–1 |
| Offer history | Single fetch filtered by `client_id` | 0–1 |
| Employee skills | Bulk-fetched with employee roster (cached) | 0 (cache hit) or N (cache miss) |

**Optimisation (implemented):** The employee roster (active employees + all their skills) is bulk-fetched once via `AlayaCareCache` (30s TTL with stampede prevention). In a burst of 20 scoring calls: the first call fetches the employee list + N parallel skills calls, then caches the result. Calls 2–20 hit the cache with 0 API calls. Schedule conflicts are checked using cached data. Visit/offer history is fetched as bulk queries filtered by `client_id` and distributed to scorers in-memory.

**Cache invalidation:** Employee lifecycle webhook handlers (`handle-employee-status-changed`, `handle-employee-unavailability`) call `alayaCareCache.invalidate(CACHE_KEY_EMPLOYEE_ROSTER)` so the next scoring call fetches fresh data.

**Downstream data passthrough:** `MatchResult` carries `fetchedVisit` and `fetchedClient` so that `buildRecommendationContext()` can skip redundant API calls when constructing the LLM reasoning context.

### Overall Score Computation

```typescript
function computeOverall(
  dimensions: DimensionBreakdown,
  weights: WeightConfig
): { overall: number; confidence: "high" | "medium" | "low" } {
  const overall =
    dimensions.skills.score * weights.skills +
    dimensions.relationship.score * weights.relationship +
    dimensions.proximity.score * weights.proximity +
    dimensions.workload.score * weights.workload +
    dimensions.acceptance.score * weights.acceptance;

  // Overall confidence = lowest dimension confidence
  const confidences = Object.values(dimensions).map(d => d.confidence);
  const confidence = confidences.includes("low") ? "low"
    : confidences.includes("medium") ? "medium"
    : "high";

  return { overall, confidence };
}
```

---

## API Endpoint

### `POST /api/v1/visits/[id]/match`

**Pattern:** Follows the existing AlayaCare proxy route pattern (traceId → requireAuthContext → handleAppError) but adds server-side computation instead of a passthrough.

**Request:**
```json
{
  "preset": "continuity_heavy",
  "limit": 10
}
```
Or with custom weights:
```json
{
  "weights": { "skills": 0.3, "relationship": 0.3, "proximity": 0.1, "workload": 0.1, "acceptance": 0.2 },
  "limit": 15
}
```

**Response:** `MatchResult` (see type definitions above).

**Validation (Zod):**
```typescript
const MatchRequestSchema = z.object({
  weights: z.object({
    skills: z.number().min(0).max(1),
    relationship: z.number().min(0).max(1),
    proximity: z.number().min(0).max(1),
    workload: z.number().min(0).max(1),
    acceptance: z.number().min(0).max(1),
  }).refine(w => {
    const sum = w.skills + w.relationship + w.proximity + w.workload + w.acceptance;
    return Math.abs(sum - 1.0) < 0.001;
  }, "Weights must sum to 1.0").optional(),
  preset: z.enum(["equal", "continuity_heavy", "efficiency_heavy"]).optional(),
  limit: z.number().int().min(1).max(50).optional(),
}).refine(
  d => !(d.weights && d.preset),
  "Provide either weights or preset, not both"
);
```

**Error responses:**
- 400 — Invalid request body (Zod validation)
- 401 — Not authenticated
- 404 — Visit not found
- 502 — AlayaCare API error during data fetch

---

## Client Hook

### `use-match.ts`

```typescript
export interface UseMatchOptions {
  preset?: PresetName;
  weights?: WeightConfig;
  limit?: number;
  enabled?: boolean;
}

/** Build the fetch options for the match endpoint. Exported for testing. */
export function buildMatchFetchOptions(options: Omit<UseMatchOptions, "enabled">) {
  const body: Record<string, unknown> = {};
  if (options.preset !== undefined) body.preset = options.preset;
  if (options.weights !== undefined) body.weights = options.weights;
  if (options.limit !== undefined) body.limit = options.limit;
  return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

export function useMatch(visitId: number | null, options: UseMatchOptions = {}) {
  const { enabled = true, ...matchOptions } = options;

  return useQuery<MatchResult>({
    queryKey: ["match", visitId, matchOptions],
    queryFn: async () => {
      const fetchOptions = buildMatchFetchOptions(matchOptions);
      const res = await apiFetch(`/api/visits/${visitId}/match`, fetchOptions);
      if (!res.ok) throw new Error("Failed to fetch match results");
      return res.json();
    },
    enabled: enabled && visitId !== null,
  });
}
```

---

## Data Quality & Confidence

Data quality is tracked at two levels:

### Per-Candidate Warnings

Each `ScoredCandidate` carries a `warnings` array. Examples:
- `"Missing coordinates — proximity score unavailable"`
- `"Skill 'Manual Handling' expired on 2025-12-01"`
- `"Only 2 historical offers — acceptance score is low confidence"`
- `"No prior visits with this client"`

### Per-Candidate Confidence

Overall confidence is the **lowest** confidence across all 5 dimensions:
- **High** — All dimensions have sufficient data
- **Medium** — 1–2 dimensions have limited data
- **Low** — Missing critical data (coordinates, skills, offer history)

### Global Warnings (`MatchResult.data_warnings`)

Aggregate issues across the candidate pool. Examples:
- `"12 of 45 employees missing coordinates"`
- `"No required skills defined for this visit — skills dimension scored as 1.0 for all"`
- `"Visit has no client_id — relationship and proximity dimensions unavailable"`

---

## Testing Strategy

### Unit Tests (per scorer)

Each scorer gets a dedicated test file testing:
- Normal case with good data
- Edge cases (nulls, zeros, empty arrays)
- Boundary values (exactly at thresholds)
- Confidence assignment logic

Example test structure:
```
src/services/scoring/
  score-proximity.ts
  score-proximity.test.ts       # Unit tests
  score-skills.ts
  score-skills.test.ts
  ...
```

### Orchestrator Tests

- Correct aggregation of dimension scores
- Weight application (verify weighted sum)
- Ranking order (higher overall first)
- Limit enforcement (top N only)
- Warning collection (per-candidate + global)
- Error handling when AlayaCare API fails

### Integration Tests

- Match endpoint returns valid `MatchResult` shape
- Auth required (401 without session)
- Zod validation (400 on bad input)
- Weight validation (must sum to 1.0)
- Preset vs custom weights mutual exclusion

---

## Performance Considerations

### Current Optimisations (Implemented)

| Optimisation | Impact |
|-------------|--------|
| Server-side `status=active` filter on employee list | Reduces payload from API |
| Cached employee roster (30s TTL + stampede prevention) | First scoring call in burst warms cache; subsequent calls → 0 API calls |
| Bulk skills fetch (all employees in parallel, cached with roster) | Eliminates N+1 per-employee skills API calls |
| Webhook-driven cache invalidation | Employee status/availability changes invalidate roster cache |
| Bulk history/offer fetch by `client_id` (single query, distributed in-memory) | Fixed API call count regardless of candidate pool |
| `fetchedVisit`/`fetchedClient` passthrough on `MatchResult` | Eliminates 2 redundant API calls in downstream `buildRecommendationContext` |
| `Promise.allSettled` for concurrent task advancement | Independent tasks don't block each other |

### Future (Production)

| Concern | Mitigation |
|---------|------------|
| Large employee pools (500+) | Pre-filtered by `status=active` server-side; add pagination if needed |
| Rate limits | Request queuing with configurable concurrency (employee roster cached with 30s TTL) |
| Response latency | Employee + skills roster cached (30s TTL); only visit-specific data needs to be fresh |

---

## PoC 2 Integration Point

The `MatchResult` type is the **contract between PoC 1 and PoC 2**. The LLM reasoning layer will receive:

1. `MatchResult.candidates` — ranked list with dimension breakdowns and reasons
2. Visit context — shift details (time, location, requirements)
3. Client context — preferences, history notes
4. Escalation criteria — rules for when to defer to human

The `DimensionScore.reason` field is specifically designed to feed into LLM prompts — it's a human-readable explanation that the LLM can reference in its reasoning output.

```
Example LLM prompt input (from MatchResult):

"Top 3 candidates for Visit #1234 (Mon 9am–12pm, client: Mrs Smith, Epping):

1. Sarah Chen (overall: 0.82, confidence: high)
   - Skills: 0.90 — "Has 4 of 5 required skills, all current"
   - Relationship: 0.77 — "10 prior visits, last 5 days ago"
   - Proximity: 0.86 — "7.2km away"
   - Workload: 0.75 — "15 shifts this fortnight (avg: 14)"
   - Acceptance: 0.82 — "Accepts 82% of morning offers"

2. James Park (overall: 0.71, confidence: medium)
   ..."
```

---

## Extensibility

### Adding a New Dimension

1. Create `score-new-dimension.ts` with pure scoring function
2. Add field to `DimensionBreakdown` and `WeightConfig`
3. Update weight presets in `weights.ts`
4. Add data fetch to `compute-match.ts` orchestrator
5. Add tests

The architecture supports N dimensions. The weighted sum and confidence logic work regardless of how many dimensions exist.

### Changing Scoring Curves

Each scorer's algorithm is isolated. Changing the relationship history scoring curve (e.g., from logarithmic to linear) requires editing only `score-relationship.ts` and its tests. No other files are affected.
