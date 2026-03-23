# Scoring Engine & Matching Algorithms: Technical Whitepaper

**DappaAi AI -- Caregiver-to-Shift Matching, Selection & Scheduling**

**Date:** 2026-03-11
**Status:** Research & Recommendation
**Audience:** Engineering team, product stakeholders

---

## 1. Executive Summary

This whitepaper evaluates mathematical tools, algorithms, and available software libraries for the caregiver matching, selection, and scheduling processes defined in the DappaAi AI Phase 1 MVP. The core problem is: given an open shift with specific requirements, rank available caregivers by suitability across multiple weighted dimensions, then contact them in priority order until the shift is filled.

The research covers five areas: multi-criteria scoring, constraint satisfaction, assignment/matching algorithms, acceptance prediction via machine learning, and available npm/TypeScript libraries. The key finding is that Phase 1's cascade-based contact model is well-served by a simple layered architecture -- constraint filtering, weighted scoring, and cascade logic -- all implementable in TypeScript without heavyweight optimization libraries. More sophisticated tools (ILP solvers, Hungarian assignment, ML prediction) become valuable in later phases for batch optimization and continuous learning.

---

## 2. Problem Definition

### 2.1 The Matching Problem

When an open shift appears (via AlayaCare or handover email), the system must:

1. Identify all caregivers who *could* fill the shift (hard constraints)
2. Rank eligible caregivers by suitability across five weighted dimensions (soft objectives)
3. Contact caregivers in priority order (sequential for planned shifts, parallel top-5 for urgent)
4. Assign the shift to the first caregiver who accepts
5. Escalate to a human if no acceptance after N attempts

### 2.2 The Five Scoring Dimensions

| # | Dimension | Type | Description |
|---|-----------|------|-------------|
| 1 | Skills & qualifications match | Hard + soft | Binary gate (must have required certs) plus degree-of-fit scoring |
| 2 | Client relationship history | Soft | Continuity of care: prior visits, ratings, familiarity |
| 3 | Geographic proximity | Soft | Travel distance/time from caregiver to client location |
| 4 | Workload balance | Soft | Hours worked this period vs target; fairness across the team |
| 5 | Acceptance likelihood | Soft | Predicted probability the caregiver will accept this shift |

### 2.3 Configurable Weighting

Administrators must be able to adjust dimension weights for different scenarios:

- **Planned shifts:** Continuity + workload balance prioritised
- **Urgent shifts:** Acceptance likelihood + proximity prioritised
- **High-value clients:** Proven track record prioritised
- **New clients:** Experienced caregivers prioritised

### 2.4 Hard Constraints

Before scoring, candidates must pass all hard constraints:

- Valid qualifications (not expired)
- No scheduling conflicts with existing assignments
- Marked as available for the shift time window
- Consecutive workday regulations satisfied
- Not suspended, on leave, or otherwise ineligible

---

## 3. Scoring & Ranking Algorithms

### 3.1 Weighted Sum Model (WSM) -- Recommended for Phase 1

The simplest and most widely adopted approach in the home care industry. Each caregiver receives a composite score for a given shift:

```
Score(c, s) = w1 * skills(c, s) + w2 * continuity(c, s) + w3 * proximity(c, s)
            + w4 * workload(c) + w5 * acceptance(c, s)
```

Where weights `w1..w5` are normalised to sum to 1.0 and each dimension function returns a value normalised to [0, 1].

**Advantages:**
- Transparent and explainable ("Sarah scored 0.87 because...")
- Maps directly to the admin-configurable weighting requirement
- Trivial to implement (~20 lines of TypeScript)
- Matches the approach used by commercial platforms including AlayaCare and CareSmartz360

**Limitations:**
- Assumes linear trade-offs between dimensions
- Sensitive to normalisation method when dimensions have different scales
- Can exhibit rank reversal when candidates are added or removed

**Implementation complexity:** Very low. No library required.

### 3.2 TOPSIS (Technique for Order of Preference by Similarity to Ideal Solution)

TOPSIS ranks alternatives by measuring Euclidean distance from an "ideal best" solution (highest score on every dimension) and an "ideal worst" solution (lowest on every dimension). It produces a closeness coefficient between 0 and 1.

**Algorithm steps:**
1. Construct the decision matrix (caregivers x dimensions)
2. Normalise using vector normalisation: `r_ij = x_ij / sqrt(sum(x_ij^2))`
3. Apply weights: `v_ij = w_j * r_ij`
4. Determine ideal best (A+) and ideal worst (A-) for each dimension
5. Calculate Euclidean distance to A+ and A- for each caregiver
6. Compute closeness coefficient: `C_i = D_i^- / (D_i^+ + D_i^-)`
7. Rank by closeness coefficient (higher is better)

**Advantages over WSM:**
- Handles mixed benefit/cost criteria naturally (maximise skills, minimise distance)
- More robust normalisation across different scales
- Less susceptible to rank reversal
- Well-studied with extensive academic literature

**When to adopt:** When the simpler WSM produces counter-intuitive rankings due to scale differences between dimensions, or when the number of dimensions grows beyond five.

**Implementation complexity:** Moderate (~50 lines TypeScript). The `topsis` npm package exists but is unmaintained.

### 3.3 AHP (Analytic Hierarchy Process)

AHP is primarily a **weight derivation** method rather than a scoring method. It uses pairwise comparisons to derive consistent weights from expert judgement.

For example, an administrator answers: "Is skills match more important than proximity? If so, by how much (1-9 scale)?" A consistency ratio validates that the comparisons are logically coherent.

**Use case:** Could provide a structured UI for administrators to set weights via pairwise comparison rather than directly entering numbers. The derived weights then feed into WSM or TOPSIS.

**Implementation complexity:** Low-moderate. Available in `pymcdm` (Python) or implementable in ~100 lines of TypeScript.

### 3.4 PROMETHEE (Preference Ranking Organization Method)

PROMETHEE uses preference functions to model non-linear relationships between criteria differences and preferences. Six preference function types are available (usual, U-shape, V-shape, level, linear, Gaussian).

**Example:** A caregiver 2km away is strongly preferred over one 10km away, but there is negligible difference between 40km and 50km. PROMETHEE's Gaussian preference function captures this diminishing sensitivity.

**When to adopt:** When domain experts confirm that linear trade-offs (as in WSM) do not reflect real preferences. Most relevant for the proximity and workload balance dimensions.

**Implementation complexity:** Moderate-high. Best accessed via Python (`pymcdm`, `pyDecision`) as a microservice.

### 3.5 Recommendation

| Phase | Approach | Rationale |
|-------|----------|-----------|
| PoC / Phase 1 | WSM | Simple, transparent, matches industry practice, directly configurable |
| Phase 2 | TOPSIS | Better normalisation as dimensions and data volume grow |
| Phase 2+ | AHP for weight derivation | Structured admin UX for setting priorities |
| Phase 3 | PROMETHEE | If non-linear preferences are validated by domain experts |

---

## 4. Constraint Satisfaction

### 4.1 The Constraint Problem

Before scoring, candidates must pass hard constraints. These form a classic Constraint Satisfaction Problem (CSP), but the structure is simple enough that a full CSP solver is unnecessary.

### 4.2 Constraint Types

| Constraint | Type | Validation |
|------------|------|------------|
| Required qualifications | Mandatory | Set intersection: caregiver certs must contain all shift-required certs |
| Qualification expiry | Mandatory | Date comparison: all required certs must be current as of shift date |
| Schedule conflicts | Mandatory | Time interval overlap check against existing assignments |
| Availability | Mandatory | Shift time falls within caregiver's declared available windows |
| Consecutive workdays | Regulatory | Count working days in rolling window; compare against jurisdiction limit |
| Maximum weekly hours | Regulatory | Sum assigned hours in current period; compare against cap |

### 4.3 Implementation Approach

For Phase 1's cascade model (filling one shift at a time), constraints are best implemented as **predicate filter functions** applied sequentially:

```typescript
const eligible = allCaregivers
  .filter(c => hasRequiredQualifications(c, shift))
  .filter(c => qualificationsNotExpired(c, shift.date))
  .filter(c => noScheduleConflict(c, shift))
  .filter(c => isAvailable(c, shift.timeWindow))
  .filter(c => consecutiveDaysWithinLimit(c, shift.date))
  .filter(c => weeklyHoursWithinCap(c, shift.duration));
```

**No CSP solver library is needed.** Each predicate is a simple function operating on the caregiver's data and the shift requirements.

### 4.4 When a Solver Becomes Valuable

Full constraint satisfaction or integer programming solvers become valuable when the problem shifts from "fill one shift" to "optimally assign all caregivers to all shifts for a period." This is a fundamentally different (and harder) problem -- the Nurse Scheduling Problem, which is NP-hard.

**Relevant solvers for future batch scheduling:**

| Tool | Language | Notes |
|------|----------|-------|
| `glpk.js` (WASM) | JavaScript | Best JS option for Mixed Integer Linear Programming |
| `yalps` | TypeScript | Pure TS, zero deps, good for small-medium LP problems |
| Google OR-Tools | Python | Industry standard for scheduling; no JS bindings |
| Timefold (OptaPlanner) | Java/Kotlin/Python | Purpose-built for employee rostering; no JS bindings |
| MiniZinc | Via `minizinc-solver` npm | Full constraint programming; requires external binary |

---

## 5. Assignment & Matching Algorithms

### 5.1 Hungarian Algorithm (Kuhn-Munkres)

An O(n^3) algorithm that finds the **globally optimal** assignment in a weighted bipartite graph. Given a cost/benefit matrix where `M[i][j]` represents the score of assigning caregiver `i` to shift `j`, it finds the assignment that maximises the total score across all shift-caregiver pairs.

**Relevance to Phase 1:** Low. The cascade model fills shifts individually -- there is no need for global optimisation. The Hungarian algorithm becomes valuable for:
- End-of-day batch reassignment to minimise total travel
- Weekly schedule optimisation for continuity of care
- "What if" analysis comparing current assignments against optimal

**Available libraries:**
- `munkres-algorithm` (npm) -- supports typed arrays and infinite weights for encoding hard constraints
- `munkres-js` (npm) -- older but stable, 24+ downstream dependents
- `scipy.optimize.linear_sum_assignment` (Python) -- gold standard, highly optimised C implementation

### 5.2 Stable Matching (Gale-Shapley)

The deferred acceptance algorithm finds a stable matching where no caregiver-shift pair would both prefer each other over their current assignments. Made famous by the National Resident Matching Program for medical residencies.

**Relevance to Phase 1:** Low. Requires both sides to have preference rankings, and the one-to-one matching assumption doesn't naturally fit the one-shift-at-a-time cascade model. Could become relevant if DappaAi evolves toward a marketplace model where caregivers express shift preferences.

**Available library:** `@rami-abdou/stable-matching` (npm, TypeScript)

### 5.3 Auction Algorithm (Bertsekas)

An iterative algorithm where unassigned agents "bid" on preferred items, raising prices until equilibrium. Naturally distributed and parallelisable.

**Relevance to Phase 1:** Conceptually interesting for the urgent shift model (multiple caregivers contacted simultaneously), but the real-world cascade logic is simpler -- contact top-5, first to accept wins. No auction mechanics needed.

### 5.4 Recommendation

| Phase | Algorithm | Use Case |
|-------|-----------|----------|
| Phase 1 | None (cascade) | Simple ranked contact in priority order |
| Phase 2 | Hungarian | Batch optimisation: reassign tomorrow's shifts for minimal travel |
| Phase 3 | Hungarian + ILP | Weekly schedule optimisation across all caregivers and shifts |
| Future | Stable Matching | If evolving to caregiver preference marketplace |

---

## 6. Machine Learning for Acceptance Prediction

### 6.1 The Prediction Problem

Dimension 5 (acceptance likelihood) requires predicting whether a specific caregiver will accept a specific shift. This is a binary classification problem with features from both the caregiver and the shift.

### 6.2 Feature Engineering

| Category | Features |
|----------|----------|
| Caregiver | Historical acceptance rate, average accepted distance, preferred shift times, current weekly hours, days since last shift, tenure |
| Shift | Start time, duration, notice period (hours until shift), day of week, client complexity level, shift type |
| Interaction | Caregiver-client history (prior visits, ratings), distance from caregiver to client, skills match percentage |
| Contextual | Holiday proximity, competing open shifts, time of day offer is sent |

### 6.3 Model Progression

#### Stage 1: Historical Rate (PoC / Early Phase 1)

No ML required. Use the caregiver's historical acceptance rate, optionally segmented by shift characteristics:

```
acceptance_likelihood = accepted_shifts / offered_shifts
```

Segmented variant: acceptance rate for this day-of-week, time-of-day, and distance range.

**Advantages:** No training data requirement beyond basic offer/response history. Fully transparent. No model infrastructure needed.

**Limitation:** Cannot capture feature interactions (e.g., a caregiver accepts distant shifts on weekdays but not weekends).

#### Stage 2: Logistic Regression (Mid Phase 1)

Once sufficient offer/response data accumulates (200+ data points), logistic regression captures linear feature effects:

```
P(accept) = sigmoid(b0 + b1*distance + b2*hours_worked + b3*prior_visits + ...)
```

**Advantages:** Interpretable coefficients directly indicate which factors drive acceptance. Fast inference. Coefficients can feed back into the scoring weight configuration. Implementable in TypeScript with no external dependencies.

**Available libraries:**
- `js-regression` (npm) -- lightweight logistic regression
- `ml-logistic-regression` (npm) -- part of the mljs ecosystem
- Custom implementation (~100 lines TypeScript)

#### Stage 3: Gradient Boosted Trees (Phase 2+)

XGBoost or LightGBM captures non-linear interactions and provides feature importance rankings that can inform weight configuration.

**Recommended production pipeline:**
1. Train in Python using scikit-learn (XGBoost/LightGBM)
2. Export model to ONNX format via `sklearn-onnx`
3. Serve predictions in Node.js via `onnxruntime-node`

This gives access to Python's mature ML ecosystem for training while keeping inference within the Node.js application.

**Available libraries for inference:**

| Package | Notes |
|---------|-------|
| `onnxruntime-node` | Microsoft. Best option for serving scikit-learn/XGBoost models in Node.js |
| `decision-tree` (npm) | Pure TypeScript Decision Tree + Random Forest + XGBoost. Good for prototyping |
| `@fractal-solutions/xgboost-js` | Pure JS XGBoost, no native deps |
| `xgboost` (nuanio) | Node.js bindings to XGBoost C++. Native dependency |

#### Stage 4: Online Learning (Phase 3)

Retrain models periodically (daily or weekly) as new acceptance/rejection data accumulates. True online learning (updating weights after each observation) is possible with SGD-based logistic regression but batch retraining on accumulated data is more practical and robust.

### 6.4 Recommendation

| Phase | Approach | Data Requirement | Library |
|-------|----------|-----------------|---------|
| PoC | Historical acceptance rate | Basic offer history | None |
| Phase 1 (early) | Segmented historical rates | 50+ offers per segment | None |
| Phase 1 (late) | Logistic regression | 200+ total offers | `js-regression` or custom TS |
| Phase 2 | XGBoost via ONNX | 1000+ offers | scikit-learn + `onnxruntime-node` |
| Phase 3 | Periodic retraining pipeline | Continuous | scikit-learn + ONNX + batch scheduler |

---

## 7. Library Reference

### 7.1 Multi-Criteria Decision Analysis

| Package | Install | Language | Status | Relevance |
|---------|---------|----------|--------|-----------|
| `topsis` | `npm i topsis` | JS | v1.3.2, ~2019, unmaintained | TOPSIS implementation with weights and min/max criteria |
| `pymcdm` | `pip install pymcdm` | Python | Active (2024+) | 20+ MCDA methods: TOPSIS, PROMETHEE, VIKOR, COPRAS |
| `pyDecision` | `pip install pyDecision` | Python | Active (2024+) | 70+ MCDA methods with visualisation |
| Custom WSM | N/A | TypeScript | N/A | ~20 lines. No library needed |

### 7.2 Linear Programming & Optimisation

| Package | Install | Language | Status | Notes |
|---------|---------|----------|--------|-------|
| `glpk.js` | `npm i glpk.js` | JS (WASM) | v5.0.0, Jan 2026 | WebAssembly port of GNU GLPK. Best JS MILP solver |
| `yalps` | `npm i yalps` | TypeScript | v0.6.3 | Pure TS, zero deps. Outperforms jsLPSolver |
| `javascript-lp-solver` | `npm i javascript-lp-solver` | JS | Stable | Simple JSON API. Good for prototyping |
| `minizinc-solver` | `npm i minizinc-solver` | JS/TS | Stable | Full constraint programming. Requires MiniZinc binary |

### 7.3 Assignment Algorithms

| Package | Install | Language | Notes |
|---------|---------|----------|-------|
| `munkres-algorithm` | `npm i munkres-algorithm` | JS | Supports typed arrays, infinite weights |
| `munkres-js` | `npm i munkres-js` | JS | v1.2.2, older but stable |
| `@rami-abdou/stable-matching` | `npm i @rami-abdou/stable-matching` | TypeScript | Clean API, Gale-Shapley |
| `scipy.optimize.linear_sum_assignment` | `pip install scipy` | Python | Gold standard Hungarian implementation |

### 7.4 Machine Learning & Prediction

| Package | Install | Language | Notes |
|---------|---------|----------|-------|
| `onnxruntime-node` | `npm i onnxruntime-node` | JS/TS | Serve scikit-learn/XGBoost models in Node.js |
| `decision-tree` | `npm i decision-tree` | TypeScript | v1.0.0 (Jan 2025). DT + RF + XGBoost in pure TS |
| `js-regression` | `npm i js-regression` | JS | Lightweight logistic + linear regression |
| `ml-logistic-regression` | `npm i ml-logistic-regression` | JS | Part of mljs ecosystem |
| `@fractal-solutions/xgboost-js` | `npm i @fractal-solutions/xgboost-js` | JS | Pure JS XGBoost, no native deps |
| `brain.js` | `npm i brain.js` | JS/TS | GPU-accelerated neural networks. Overkill for this use case |

### 7.5 Python Libraries (via microservice)

| Library | Install | Purpose |
|---------|---------|---------|
| `scipy.optimize` | `pip install scipy` | `linear_sum_assignment` (Hungarian), general optimisation |
| Google OR-Tools | `pip install ortools` | Constraint programming, VRP, scheduling (no JS bindings) |
| scikit-learn | `pip install scikit-learn` | LogisticRegression, GradientBoosting, ONNX export pipeline |
| `pymcdm` | `pip install pymcdm` | Comprehensive MCDA library (20+ methods) |
| Timefold | Java/Kotlin/Python | Purpose-built for employee rostering (no JS bindings) |

---

## 8. Recommended Architecture

### 8.1 Phase 1 Layered Design

```
                    Open Shift Detected
                           |
                    [Layer 1: Constraint Filter]
                    Hard constraint predicates
                    (TypeScript, no library)
                           |
                    [Layer 2: Multi-Factor Scoring]
                    WSM with admin-configurable weights
                    (TypeScript, no library)
                           |
                    [Layer 3: Confidence Classification]
                    High / Medium / Low based on score
                    distribution and data completeness
                           |
                    [Layer 4: Cascade Logic]
                    Sequential (planned) or
                    Parallel top-5 (urgent)
                    (TypeScript, no library)
                           |
              Accept?  ---Yes---> Assign in AlayaCare
                |
                No / Timeout
                |
           Next in ranked list
                |
           Exhausted top N? ---> Escalate to human
```

### 8.2 Dimension Normalisation

Each scoring dimension must return a value in [0, 1] for WSM to work correctly:

| Dimension | Normalisation Strategy |
|-----------|----------------------|
| Skills match | `matched_skills / required_skills` (1.0 = all matched, bonus for extra relevant skills capped at 1.0) |
| Client relationship | `min(prior_visits, cap) / cap` where cap = 20, adjusted by recency and ratings |
| Proximity | `1 - min(distance, max_distance) / max_distance` where max_distance is configurable (e.g., 50km) |
| Workload balance | `1 - abs(current_hours - target_hours) / target_hours`, clamped to [0, 1] |
| Acceptance likelihood | Direct probability [0, 1] from historical rate or ML model |

### 8.3 Weight Presets

| Scenario | Skills | Continuity | Proximity | Workload | Acceptance |
|----------|--------|------------|-----------|----------|------------|
| Planned (default) | 0.20 | 0.30 | 0.15 | 0.20 | 0.15 |
| Urgent | 0.15 | 0.10 | 0.25 | 0.10 | 0.40 |
| High-value client | 0.15 | 0.35 | 0.15 | 0.10 | 0.25 |
| New client | 0.25 | 0.05 | 0.20 | 0.25 | 0.25 |
| Efficiency | 0.15 | 0.10 | 0.30 | 0.30 | 0.15 |

### 8.4 Confidence Scoring

Classify each recommendation's confidence based on score distribution and data quality:

| Confidence | Criteria |
|------------|----------|
| High | Top candidate score > 0.75 AND gap to #2 > 0.10 AND all dimension data complete |
| Medium | Top candidate score 0.50-0.75 OR gap to #2 < 0.10 OR 1+ dimension has incomplete data |
| Low | Top candidate score < 0.50 OR 2+ dimensions have incomplete data OR fewer than 3 eligible candidates |

Low confidence triggers an escalation flag in the recommendation.

### 8.5 Explainability Output

Each recommendation generates a natural language explanation:

> "Sarah recommended (score: 0.87, confidence: high): 8 prior visits with client (continuity: 0.92), 5-star average rating, 12 mins away (proximity: 0.85), currently at 32/38 target hours (workload: 0.84), accepts evening shifts 85% of the time (acceptance: 0.85)."

This maps directly to the Phase 1 requirement for explainable recommendations.

---

## 9. Evolution Path

| Phase | Scoring | Constraints | Assignment | Prediction | Key Library Additions |
|-------|---------|-------------|------------|------------|----------------------|
| PoC | WSM | Predicate filters | Single-shift cascade | Historical rate | None |
| Phase 1 MVP | WSM | Predicate filters | Single-shift cascade | Segmented rates / logistic regression | `js-regression` (optional) |
| Phase 2 | TOPSIS | Predicate filters + batch ILP | Cascade + batch Hungarian | XGBoost via ONNX | `munkres-algorithm`, `onnxruntime-node` |
| Phase 3 | TOPSIS + PROMETHEE | `glpk.js` for weekly scheduling | Hungarian + ILP batch | Periodic retraining pipeline | `glpk.js`, scikit-learn (Python) |

---

## 10. Academic & Industry References

### Home Care Scheduling Literature
- "Bi-Objective Home Health Care Routing and Scheduling" -- PMC/NIH (2024). Models the HHCRSP as a variant of VRP with time windows, skill requirements, and continuity of care.
- "Joint Optimization of Routing and Scheduling in Home Health Care" -- arXiv (2025). Addresses multi-factor matching including qualifications, continuity, and workload balance.
- "Dynamic Routing-Scheduling with Caregiver-Patient Compatibility" -- Computers & Operations Research (2022). Models caregiver-patient compatibility as a first-class constraint.
- "Modified Memetic Algorithm for Home Health Care" -- Computers & Industrial Engineering (2025). Uses metaheuristics considering skill deviation and synchronous service.

### Nurse Scheduling
- "Integer Programming for Nurse Scheduling" -- World Journal of Advanced Research and Reviews (2025). Comprehensive survey of ILP formulations for the nurse scheduling problem.
- "Nurse Scheduling Using ILP and CP" -- IFAC-PapersOnLine. Comparative study showing ILP yields superior solutions for penalty minimisation.

### MCDA Methods
- "An Overview of Multi-Criteria Decision Analysis: AHP and TOPSIS" -- ResearchGate (2024).
- "A Comprehensive Guide to the TOPSIS Method" -- ResearchGate (2023).
- "PROMETHEE Methods" -- Springer, Multiple Criteria Decision Analysis.

### Industry Practice
- AlayaCare documentation on caregiver-client matching: confirms the 5-factor model (skills, proximity, continuity, availability, labour constraints) as industry standard.
- CareSmartz360 documentation on AI-powered scheduling: confirms weighted multi-factor scoring as the dominant commercial approach.

---

## 11. Conclusion

The Phase 1 matching engine does not require heavyweight optimisation libraries. The cascade contact model -- where shifts are filled one at a time by contacting ranked caregivers -- is well-served by:

1. **Constraint filtering** as TypeScript predicate functions
2. **Weighted Sum Model** scoring with admin-configurable weights
3. **Cascade logic** (sequential or parallel) implemented directly
4. **Historical acceptance rates** as the initial acceptance likelihood dimension

This approach is transparent, explainable, and matches industry practice. It requires zero external libraries for the core scoring engine.

The path to sophistication is incremental: TOPSIS for better normalisation, logistic regression then XGBoost for acceptance prediction, and the Hungarian algorithm or ILP solvers for batch schedule optimisation. Each upgrade can be adopted independently when the data and business case justify it.
