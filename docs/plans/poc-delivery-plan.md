# DappaAi AI — PoC & Phase 1 Delivery Plan

End-to-end project plan for delivering PoC 1 (AlayaCare API Integration & Scoring), PoC 2 (LLM Reasoning for Caregiver Selection), and Phase 1 MVP (Autonomous Shift Filling).

**Last updated:** 2026-03-12 (All phases complete — PoC 1 + PoC 2 + Phase 1 done)

**Reference documents:**
- Requirements: `docs/poc.txt`
- Traceability: `docs/poc-traceability.md`
- Feature inventory: `docs/features.md`
- Main architecture: `docs/ARCHITECTURE.md`
- Scoring engine architecture: `docs/scoring-engine-architecture.md`
- Scoring engine whitepaper: `docs/scoring-engine-whitepaper.md`
- Scoring engine implementation plan: `docs/plans/scoring-engine-plan.md`
- Phase 1 rostering architecture: `docs/phase1-rostering-architecture.md`
- Roster evolution strategy: `docs/roster-evolution-strategy.md` (A→D→C phased approach)

---

## Strategy

### Environment Progression

| Phase | Environment | Purpose |
|-------|-------------|---------|
| Build & iterate | mock-alaya (mock-alaya.vercel.app) | Develop scoring, LLM logic, and UI against controlled data |
| Contract validation | AlayaCare sandbox (Dovida) | Validate mock assumptions against real API responses |
| Scenario testing | Sandbox + real test data | Run 30+ scenarios, measure scoring accuracy, demo to stakeholders |

### Key Principles

1. **Mock-first development** — build everything against mock-alaya, switch to sandbox via `ALAYACARE_API_URL` env var when available
2. **Edge cases in mock data** — include nulls, missing geo coords, expired skills, and data quality issues in mock responses now
3. **Incremental demos** — each sprint produces a demonstrable increment against the traceability matrix
4. **Contract validation checkpoint** — when sandbox access arrives, run a contract comparison before building further
5. **TDD throughout** — all scoring and service code follows red-green-refactor cycle
6. **Architecture-first** — scoring engine plan reconciles architecture doc and whitepaper decisions *before* implementation begins

---

## Current State (2026-03-12)

### What's Built

| Area | Status | Details |
|------|--------|---------|
| AlayaCare API proxy | DONE | 6 GET + 2 POST endpoints via `alayaFetch`, authenticated, error-handled |
| Data hooks | DONE | TanStack Query hooks for all AlayaCare entities with shared pagination type |
| Browse UI | DONE | Dashboard (4 metrics) + clients/employees/visits list pages with search |
| Auth & sessions | DONE | Supabase Auth, session tracking, device fingerprinting |
| Architecture | DONE | Layered pattern (transport → handler → service → DB), UoW, RLS, structured logging |
| Scoring engine | DONE | 5-dimension WSM, hard constraints, 5 presets, confidence scoring (Sprints 1–2) |
| Match API & UI | DONE | `POST /visits/[id]/match`, match results UI, visit detail page (Sprint 2) |
| Workflows | DONE | Availability query, assignment workflow, shift status monitoring (Sprint 3) |
| Edge cases & security | DONE | Mock fixtures, edge case docs, security assessment (Sprint 3) |
| Scenario testing | DONE | 32 scenarios across 6 categories, comparison report tooling (Sprint 4) |
| PoC 1 deliverable | DONE | Workaround doc, production pathway, formal deliverable document (Sprint 4) |
| LLM reasoning | DONE | Bedrock Haiku 4.5 reasoning service, 32 baselines, evaluation framework (Sprints 5–7) |
| Recommend API & UI | DONE | `POST /visits/[id]/recommend`, recommendation panel, evaluation CLI (Sprint 7) |
| PoC 2 deliverable | DONE | Formal technical report — `docs/poc2-deliverable.md` (Sprint 7) |
| Workflow orchestrator | DONE | 11-state machine, urgency classifier, data validator (Sprint P1.1) |
| Communication layer | DONE | SMS/email mock providers (Twilio/SES stubs), templates, dispatcher (Sprints P1.3, P1.6) |
| Cascade & escalation | DONE | Sequential + parallel cascade, time/count/LLM escalation triggers (Sprint P1.4) |
| Operations UI | DONE | Roster dashboard, escalation console, audit trail, analytics (Sprints P1.4–P1.7) |
| Chat tools | DONE | 4 read + 3 write tools with SSE confirmation flow (Sprints P1.7–P1.8) |
| Learning system | DONE | Outcome tracking, pattern recognition, acceptance feedback loop (Sprint P1.8) |
| Tests | DONE | 554 tests across 65 files (unit + integration + E2E + performance + evaluation) |
| Architecture docs | DONE | All architecture, deliverable, and plan docs updated |

### Traceability Summary

| Phase | Total | DONE | PARTIAL | NOT STARTED |
|-------|-------|------|---------|-------------|
| PoC 1 | 29 | 24 | 1 | 4 |
| PoC 2 | 9 | 9 | 0 | 0 |
| Phase 1 | 21 | 20 | 0 | 1 |
| **Total** | **59** | **53** | **1** | **5** |

**Notes:** PoC 1 remaining items are rate limit testing (R1.6), real notifications (R3.2/R3.3), API perf testing (R3.4). Phase 1 P1.12 (app notification) deferred to Phase 2.

### Key Technical Decisions (Resolved)

#### Scoring Engine Decisions (PoC 1–2)

Resolved in the scoring engine reconciliation (`docs/plans/scoring-engine-plan.md` §1.2):

| ID | Decision | Source |
|----|----------|--------|
| G1 | Hard constraint filter layer *before* scoring (qualifications + schedule conflicts) | Whitepaper |
| G2 | 5 weight presets: planned, urgent, high_value_client, new_client, efficiency | Whitepaper |
| G3 | Default preset: "planned" (continuity-biased, not equal-weight) | Whitepaper |
| G4 | Workload scoring: Gaussian with asymmetric overload penalty | Architecture |
| G5 | Relationship scoring: logarithmic with recency multiplier | Architecture |
| G6 | Dual confidence: per-candidate (lowest dimension) + per-match (score distribution) | Both |
| G7 | Skills as hard+soft: hard filter for mandatory quals, soft scoring for degree of fit | Whitepaper |
| G8 | Acceptance prediction: simple ratio for PoC, ML evolution roadmapped | Architecture + whitepaper roadmap |
| G9 | Explainability: `DimensionScore.reason` per scorer (PoC); full NL summary via LLM (PoC 2) | Architecture |

#### Phase 1 Architectural Decisions

Resolved in Phase 1 rostering architecture (`docs/phase1-rostering-architecture.md` §Key Architectural Decisions):

| ID | Decision | Rationale |
|----|----------|-----------|
| P1 | **Async pipeline, not long-running process** | Next.js serverless constraints; state persisted to DB between steps; webhooks/polls trigger advancement |
| P2 | **LLM for reasoning, not scoring** | Scoring is deterministic math; LLM adds contextual interpretation, escalation judgement, and NL explanations |
| P3 | **Provider-abstracted communication** | SMS (Twilio/SNS) and email (SendGrid/SES) behind interfaces; swappable without workflow changes |
| P4 | **Append-only audit log** | Separate table from task record; never modified; supports compliance and transparency |
| P5 | **JSONB for flexible data** | `match_result`, `llm_recommendation`, `contacts` as JSONB — schema evolves without migrations during rapid iteration |
| P6 | **Urgency drives strategy** | Single classification (planned/urgent) determines weight preset, cascade mode, expiry window, and escalation threshold |
| P7 | **Webhook-first, polling-fallback** | AlayaCare webhooks for real-time triggers; polling as fallback if unavailable |
| P8 | **Local DB for task state, AlayaCare for entity data** | RosterTask lifecycle is ours; caregiver/client/visit data stays in AlayaCare (source of truth) |

---

## PoC 1: AlayaCare API Integration & Scoring Dimensions

### Pre-Sprint: Mock Data Verification (0.5 day)

Before Sprint 1 begins, verify mock-alaya has the data the scorers need:

| Check | Endpoint | Required Fields |
|-------|----------|-----------------|
| Employee skills with expiry | `GET /ext/api/v2/employees/{id}/skills` | `skill_id`, `expired_date` |
| Visit offers (accept/decline history) | `GET /ext/api/v2/scheduler/visit_offers` | `employee_id`, `status` (accepted/declined/pending) |
| Client required qualifications | `GET /ext/api/v2/clients/{id}` or visit data | `required_skill_ids` or equivalent |
| Employee coordinates | `GET /ext/api/v2/employees` | `latitude`, `longitude` (some null for testing) |
| Visit schedule data (for conflict checks) | `GET /ext/api/v2/scheduler/visits` | `start_at`, `end_at`, `employee_id` |

**Action:** Add missing mock endpoints or data if any check fails. Document field mappings.

---

### Sprint 1: Scoring Algorithm Core (Est. 3–4 days)

**Goal:** Working match scoring service that calculates ranked caregiver lists for a given visit. All code TDD.

**Detailed task breakdown:** See `docs/plans/scoring-engine-plan.md` §5, Sprint 1 (Tasks 1.0–1.9).

| Task | Req | Description | Est. |
|------|-----|-------------|------|
| 1.0 | — | **Types & weight presets** — `types.ts` with all interfaces, `weights.ts` with 5 presets (G2, G3) | 0.5d |
| 1.1 | R2.2 | **Hard constraint filter** — `constraints.ts`: qualification check, expiry check, schedule conflict check (G1, G7) | 0.5d |
| 1.2 | R2.2 | **Skills match scorer** — `score-skills.ts`: `valid_matched / required_count`, soft scoring only (hard filter already applied) | 0.5d |
| 1.3 | R2.3 | **Relationship history scorer** — `score-relationship.ts`: logarithmic `ln(count+1)/ln(20)` × recency multiplier (G5) | 0.5d |
| 1.4 | R2.4 | **Geographic proximity scorer** — `score-proximity.ts`: Haversine distance, linear decay `max(0, 1-d/50)` | 0.5d |
| 1.5 | R2.5 | **Workload balance scorer** — `score-workload.ts`: Gaussian `exp(-0.5z²)` with 1.5× overload penalty (G4) | 0.5d |
| 1.6 | R2.6 | **Acceptance likelihood scorer** — `score-acceptance.ts`: `accepted/(accepted+declined)`, confidence tiers | 0.5d |
| 1.7 | R2.1 | **Match confidence calculator** — `match-confidence.ts`: distribution-based confidence (G6) | 0.25d |
| 1.8 | R2.1 | **Orchestrator** — `compute-match.ts`: fetch → filter → score → rank → warnings. Only module with I/O. | 0.75d |
| 1.9 | — | **Barrel export** — `index.ts` | 0.1d |

**Deliverables:**
- `src/services/scoring/` — 10 source files + 10 co-located test files
- ~51 unit tests covering all scorers, constraints, orchestrator (mocked I/O)
- Type definitions: `DimensionScore`, `ScoredCandidate`, `WeightConfig`, `MatchResult`, `HardConstraintResult`

**Acceptance criteria:**
- All 5 scorers return correct values for known inputs
- Hard constraint filter correctly excludes ineligible candidates
- Orchestrator produces correctly ranked output with proper warning collection
- `npx tsc --noEmit` clean, all tests pass

---

### Sprint 2: Match Endpoint & Data Validation (Est. 2–3 days)

**Goal:** API endpoint that returns ranked caregivers for a visit, with data quality indicators and a UI to view results.

**Detailed task breakdown:** See `docs/plans/scoring-engine-plan.md` §5, Sprint 2 (Tasks 2.1–2.6).

| Task | Req | Description | Est. |
|------|-----|-------------|------|
| 2.1 | R2.8 | **Match endpoint** — `POST /api/v1/visits/[id]/match` with Zod validation, 5 weight presets, auth enforcement | 0.5d |
| 2.2 | — | **API rewrite** — add `/api/visits/:id/match` → `/api/v1/visits/:id/match` in `next.config.ts` | 0.1d |
| 2.3 | — | **Client hook** — `use-match.ts`: TanStack Query wrapper with preset/weights/limit options | 0.25d |
| 2.4 | R2.8, R2.9 | **Match results UI** — ranked candidates with dimension breakdown, confidence, warnings, preset selector | 1–1.5d |
| 2.5 | R1.8 | **Data completeness validation** — enhance warning collection: missing coords, no skills, no required skills | 0.5d |
| 2.6 | — | **Documentation update** — update architecture docs, ARCHITECTURE.md, traceability | 0.25d |

**Deliverables:**
- Working match endpoint returning `MatchResult`
- Client hook (`use-match.ts`) + match results UI
- ~6 integration tests (auth, validation, preset vs weights, error responses)
- Updated architecture documentation

**Acceptance criteria:**
- `POST /api/v1/visits/[id]/match` returns valid `MatchResult` shape
- Auth required (401 without session)
- Zod rejects bad input (400) and mutual exclusion of weights/preset
- All 5 presets selectable; correct weights applied
- Data quality warnings visible in UI
- ~57 total tests passing (51 unit + 6 integration)
- Requirements R2.1–R2.8 markable as DONE in traceability

---

### Sprint 3: Workflows & Edge Cases (Est. 2–3 days)

**Goal:** Validate core integration workflows end-to-end; document limitations.

| Task | Req | Description | Dependencies |
|------|-----|-------------|--------------|
| 3.1 | R3.1 | ✅ **Combined availability query** — `POST /api/v1/availability` accepts client_id + date, finds visits, scores against first match | Sprint 2 match endpoint |
| 3.2 | R3.2 | ✅ **Assignment workflow test** — 3 integration tests: full workflow, AlayaCare rejection (502), cascade to second candidate | Existing POST endpoints |
| 3.3 | R3.3 | ✅ **Status monitoring** — `VisitDetailCard` with `getShiftStatus()` pure function, clock_in/clock_out display, status badges | Existing visit data |
| 3.4 | R1.7 | ✅ **Mock data fixtures** — 150 employees, 55 visits, ~800 offers, 10 skill types with comprehensive edge cases (in `src/test/fixtures/`) | mock-alaya server |
| 3.5 | R3.6 | ✅ **Edge case documentation** — `docs/poc1-edge-cases.md` — data quality, API limitations, error scenarios, conflicting updates | All above |
| 3.6 | R3.7 | ✅ **Security & audit assessment** — `docs/poc1-security-assessment.md` — auth, traceability, input validation, compliance gaps | Existing implementation |

**Deliverables:**
- Combined availability query endpoint or UI workflow
- End-to-end assignment demonstration
- `docs/poc1-edge-cases.md` — limitations and workarounds
- `docs/poc1-security-assessment.md` — security and compliance notes

---

### Sprint 4: Validation & Scenario Testing (Est. 2–3 days)

**Goal:** Run 30+ scoring scenarios; compare against expected outcomes; produce PoC 1 deliverable.

| Task | Req | Description | Dependencies |
|------|-----|-------------|--------------|
| 4.1 | R4.2 | **30+ test scenarios** — create test fixtures covering: straightforward matches, multi-qualified candidates, rural (sparse) pools, urgent vs planned weight presets, new vs established clients, hard constraint edge cases | Sprint 1–3 |
| 4.2 | R2.9 | **Comparison tooling** — script or UI that runs scoring against test scenarios, outputs results in reviewable format (CSV/table), allows side-by-side with expected rankings | Match endpoint |
| 4.3 | R4.3 | **Workaround documentation** — document any manual steps needed, API gaps, data not available via API | Edge case doc |
| 4.4 | R4.5 | **Production pathway** — document what changes for production: real auth credentials, sandbox → production URL, rate limiting strategy, caching needs, monitoring | All above |
| 4.5 | — | **PoC 1 deliverable document** — technical architecture doc (formal PoC 1 deliverable per requirements): integration approach, scoring prototype results, API capability matrix, limitations, security requirements, Phase 1 effort estimate | All above |

**Deliverables:**
- Test scenario fixtures (JSON or TypeScript) — 30+ scenarios across 5+ categories
- Comparison report: algorithm rankings vs expected outcomes
- `docs/poc1-deliverable.md` — formal technical architecture document

### PoC 1 Success Gate

Before moving to PoC 2, verify:

| Criterion | Req | Metric |
|-----------|-----|--------|
| All critical read/write operations working | R4.1 | 6 GET + 2 POST endpoints functional + match endpoint |
| Match scores calculated for 30+ scenarios | R4.2 | Comparison report produced with all 5 presets |
| Hard constraints correctly filter ineligible candidates | G1, G7 | Scenarios include constraint violations |
| Manual workarounds documented | R4.3 | Edge case doc complete |
| Security requirements understood | R4.4 | Security assessment complete |
| Production pathway clear | R4.5 | Production pathway doc complete |

---

## PoC 2: LLM Reasoning for Caregiver Selection

### Sprint 5: Scenario Development & Prompt Engineering (Est. 3–4 days)

**Goal:** Test scenarios categorised; LLM prompts designed and working against scored data from PoC 1.

| Task | Req | Description | Dependencies |
|------|-----|-------------|--------------|
| 5.1 | R5.1 | **Test scenario categorisation** — reuse Sprint 4 scenarios (30–50); categorise as straightforward / ambiguous / edge case / constraint violation | PoC 1 test scenarios |
| 5.2 | R5.2 | **Human decision baseline** — document the "correct" decision for each scenario (what an experienced rostering staff member would do) | Domain expertise input |
| 5.3 | R6.1 | **Prompt design** — create prompt template per Phase 1 architecture (`ROSTERING_SYSTEM_PROMPT` + context template). Input: `MatchResult` with dimension breakdown + visit/client context + escalation criteria | `MatchResult` type from PoC 1 |
| 5.4 | R6.2 | **Structured output parsing** — implement `LLMRecommendation` type with JSON schema validation: primary recommendation, escalation decision, factors, trade-offs | Task 5.3 |
| 5.5 | R6.3 | **LLM provider evaluation** — test prompts against 2–3 providers (existing Bedrock Haiku 4.5 + at least one other); compare quality, latency, cost per scenario | Bedrock client at `src/lib/llm/` |

**Key design decisions (from Phase 1 architecture):**
- Structured output: JSON schema (not function calling) — simpler, works across providers
- Temperature: 0.3 (low — rostering decisions should be consistent)
- Context window: top 5–10 candidates with dimension breakdown + visit context
- Confidence: LLM self-assessed (high/medium/low) validated against score distribution

**Deliverables:**
- Categorised test scenario set with human baselines
- `src/services/reasoning/` — prompts.ts, reasoning-service.ts, parse-response.ts, types.ts
- LLM provider comparison matrix (quality, latency, cost)

---

### Sprint 6: Escalation Logic & Evaluation (Est. 3–4 days)

**Goal:** Validate escalation decisions; measure accuracy against human baseline.

| Task | Req | Description | Dependencies |
|------|-----|-------------|--------------|
| 6.1 | R7.1 | **Escalation detection** — test LLM's ability to identify scenarios requiring human judgement per escalation criteria (from Phase 1 architecture system prompt): low confidence, compliance concerns, insufficient candidates, conflicting data, high-priority client with no prior relationship | Sprint 5 prompts |
| 6.2 | R7.2 | **Escalation metrics** — measure false positive rate (unnecessary escalations) and false negative rate (missed escalations) across all scenario categories | Human baseline |
| 6.3 | R7.3 | **Escalation tuning** — adjust prompt criteria and confidence thresholds to achieve targets: ≥90% appropriate escalation, <20% false positive rate | Tasks 6.1–6.2 |
| 6.4 | R8.1 | **Explanation generation** — for each decision, generate: recommendation summary, key factors, trade-offs considered, escalation rationale (if applicable). Format per `LLMRecommendation.primary.explanation` | Sprint 5 prompts |
| 6.5 | R8.2 | **Explanation review** — present explanations to stakeholders/domain experts for clarity and trustworthiness feedback | Task 6.4 |

**Escalation urgency levels (from Phase 1 architecture):**
- **Immediate** → skip contact, escalate to human now
- **Before shift** → try contact, but alert human in parallel
- **Informational** → proceed normally, log note for review

**Deliverables:**
- Escalation accuracy report (by scenario category)
- Tuned prompt templates with optimised escalation criteria
- Sample explanations for stakeholder review

---

### Sprint 7: Integration & PoC 2 Deliverable (Est. 2–3 days)

**Goal:** End-to-end flow working; formal deliverable produced.

| Task | Req | Description | Dependencies |
|------|-----|-------------|--------------|
| 7.1 | — | **End-to-end flow** — visit → scoring (PoC 1) → LLM reasoning → recommendation + explanation → escalation decision; single API call or UI workflow | All above |
| 7.2 | — | **Recommendation UI** — display LLM recommendation with explanation, confidence, escalation status, and scored candidates; allow human override of recommendation | Task 7.1 |
| 7.3 | R9.1–R9.3 | **Final evaluation** — run all scenarios through complete pipeline; measure against success criteria | Tasks 7.1–7.2 |
| 7.4 | — | **PoC 2 deliverable** — technical report: LLM performance metrics by category, recommended provider, escalation criteria tuning, example explanations, Phase 1 integration pathway | All above |

**Deliverables:**
- Working end-to-end recommendation flow (scoring → reasoning → recommendation)
- `docs/poc2-deliverable.md` — formal technical report

### PoC 2 Success Gate

| Criterion | Req | Target |
|-----------|-----|--------|
| LLM matches experienced staff decisions | R9.1 | ≥75% on straightforward scenarios |
| LLM correctly escalates ambiguous cases | R9.2 | ≥85% appropriate escalation, <20% false positive |
| Explanations rated clear and trustworthy | R9.3 | ≥80% positive rating from reviewers |

---

## Phase 1 MVP: Autonomous Shift Filling (Weeks 9–24)

Phase 1 builds on PoC 1 (scoring engine) and PoC 2 (LLM reasoning validation) to deliver end-to-end autonomous shift filling with text-based communication.

**Full architecture:** `docs/phase1-rostering-architecture.md`

### Phase 1 Success Metrics (from requirements)

| Metric | Target |
|--------|--------|
| Reduction in shift-filling phone calls | ≥30% |
| Average time-to-fill (planned shifts) | ≤20 minutes |
| First-contact acceptance rate | ≥30% (from ~10% baseline) |

### Phase 1 System Overview

```
                         ┌─────────────────────────────────────┐
                         │       Trigger Sources                │
                         │  AlayaCare webhook  │  Email inbox   │
                         │  Manual request     │  Conversational│
                         └──────────┬──────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────┐
│                    Workflow Orchestrator                              │
│  1. Trigger detection → 2. Context gathering → 3. Scoring            │
│  4. LLM reasoning → 5. Decision (assign │ escalate │ cascade)        │
│  6. Communication dispatch → 7. Assignment execution                 │
│  8. Escalation to human → 9. Response monitoring                     │
│  10. Outcome logging → 11. Learning                                  │
└──────────────────────────────────────────────────────────────────────┘
         │                      │                        │
         ▼                      ▼                        ▼
┌──────────────┐    ┌───────────────┐      ┌──────────────────────┐
│ Communication │    │  AlayaCare    │      │  Human-in-the-Loop   │
│  SMS │ Email  │    │  (write-back) │      │  Dashboard, console  │
└──────────────┘    └───────────────┘      │  Audit, analytics    │
                                           └──────────────────────┘
```

### Phase 1 Architecture Layers

```
┌─────────────────────────────────────────────────────────────────┐
│  Human-in-the-Loop Interface (UI)                                │
│  Dashboard, escalation console, audit viewer, chat interface     │
├─────────────────────────────────────────────────────────────────┤
│  Workflow Orchestrator (new)                                     │
│  State machine for shift-filling lifecycle                       │
├──────────────┬──────────────────────────────────────────────────┤
│  LLM Reasoning│  Communication     │  Scoring Engine             │
│  Layer (new)  │  Layer (new)       │  (from PoC 1)               │
│  Bedrock API  │  SMS, email, app   │  Pure algorithmic            │
├──────────────┴──────────────────────────────────────────────────┤
│  AlayaCare Integration (existing + webhooks)                     │
├─────────────────────────────────────────────────────────────────┤
│  Core Platform (existing): Auth, UoW, RLS, logging              │
└─────────────────────────────────────────────────────────────────┘
```

### Phase 1 Feature Areas

| Layer | Components | Dependencies |
|-------|-----------|-------------|
| **Workflow Orchestrator** | State machine, task persistence, cascade engine, urgency classifier, trigger detection | PoC 1 + PoC 2 complete, DB migration for `roster_tasks` |
| **Communication Layer** | SMS provider (Twilio/SNS), email provider (SendGrid/SES), response handler, cascade logic | SMS/email provider accounts |
| **Human-in-the-Loop UI** | Operations dashboard, escalation console, audit trail, analytics, conversational interface | Orchestrator + task persistence |

### State Machine

Each shift-filling task progresses through these states (see Phase 1 architecture §1):

```
DETECTED → GATHERING → SCORING → REASONING → CONTACTING → ACCEPTED → ASSIGNED → COMPLETED
                                      │             │
                                      ▼             ▼
                                  ESCALATED    NO_RESPONSE → CASCADING (loops back to CONTACTING)
```

- `RosterTaskStatus`: `detected | gathering | scoring | reasoning | contacting | cascading | accepted | assigned | escalated | completed | cancelled`
- Each state transition is a discrete function call that updates the task record and schedules the next step (P1 decision — async pipeline)

### Urgency Classification

Urgency is the single control variable that drives multiple behaviours (P6 decision):

| Factor | Planned | Urgent |
|--------|---------|--------|
| **Trigger** | >4hrs to shift start | <4hrs to shift OR "URGENT" flag |
| **Weight preset** | `continuity_heavy` (relationship-biased) | `efficiency_heavy` (proximity + acceptance) |
| **Cascade strategy** | Sequential (one at a time) | Parallel (top 5 simultaneously) |
| **Expiry window** | 2 hours per contact | 20 minutes per contact |
| **Escalation threshold** | After top 10 contacts exhausted | After 15 minutes with no response |

### Key Type Definitions

Core types from Phase 1 architecture (§1) — full definitions in `src/services/rostering/types.ts`:

- **`RosterTask`** — Persistent record of shift-filling workflow: visit_id, status, urgency, match_result (JSONB), llm_recommendation (JSONB), contacts (ContactAttempt[]), cascade_strategy, timing fields, audit_log
- **`ContactAttempt`** — Record of outreach to a single caregiver: employee_id, rank, overall_score, channel (`"sms" | "email"`), sent_at, expires_at, response (pending/accepted/declined/expired), selection_reason. Note: `"app_notification"` channel deferred to Phase 2 (requires AlayaCare push notification API access)
- **`AuditEntry`** — Immutable log entry: timestamp, action, actor (system/llm/user_id), details (JSONB), reasoning
- **`LLMRecommendation`** — Structured LLM output: primary (employee, explanation, confidence), escalation (should_escalate, reason, urgency level), factors_considered[], trade_offs[], usage metadata

### Phase 1 Database Schema

3 new tables (full SQL in Phase 1 architecture §6):

| Table | Purpose | Key Columns | RLS |
|-------|---------|-------------|-----|
| `roster_tasks` | Task state persistence | id, user_id, visit_id, status, urgency, match_result (JSONB), llm_recommendation (JSONB), contacts (JSONB), cascade_strategy, assigned_employee_id, timing fields | `user_id = auth.uid()` |
| `roster_audit_log` | Append-only audit trail (P4) | id, task_id (FK), user_id, action, actor, details (JSONB), reasoning | `user_id = auth.uid()` |
| `roster_daily_metrics` | Materialised analytics | id, user_id, date (UNIQUE with user_id), tasks_created, tasks_filled_autonomous, tasks_escalated, avg_time_to_fill_ms, first_contact_acceptance_rate | `user_id = auth.uid()` |

**Design note (P5):** `match_result`, `llm_recommendation`, and `contacts` stored as JSONB — schema evolves without migrations during rapid iteration. Trade-off: queries within JSONB arrays (e.g., "find all tasks where employee X was contacted") require `sql` template literals in Drizzle and are slower than relational queries. For MVP, filter in application code after fetching. If query performance becomes an issue post-MVP, consider denormalising `contact_attempts` into a separate table.

### Phase 1 API Routes

| Method | Route | Purpose | Sprint |
|--------|-------|---------|--------|
| POST | `/api/v1/roster/tasks` | Create roster task (manual trigger) | P1.1 |
| GET | `/api/v1/roster/tasks` | List active tasks (filterable by status) | P1.1 |
| GET | `/api/v1/roster/tasks/[id]` | Task detail with full audit trail | P1.1 |
| PATCH | `/api/v1/roster/tasks/[id]` | Human actions (accept, assign, defer, take over, cancel) | P1.5 |
| GET | `/api/v1/roster/escalations` | Escalated tasks queue | P1.5 |
| GET | `/api/v1/roster/analytics` | 30-day metrics | P1.7 |
| GET | `/api/v1/roster/audit` | Searchable audit log | P1.7 |
| POST | `/api/v1/webhooks/alayacare` | AlayaCare event webhook receiver | P1.6 |
| POST | `/api/v1/webhooks/sms` | Inbound SMS webhook | P1.3 |
| POST | `/api/v1/webhooks/email` | Inbound email webhook | P1.6 |

All internal routes follow existing pattern: `traceId → requireAuthContext → makeDeps() → handler → Response.json()`. External webhook routes use signature verification (not user auth).

**Rewrites:** The existing `next.config.ts` catch-all rewrite (`/api/:path*` → `/api/v1/:path*`) should cover new routes automatically. Verify in Sprint P1.1 when the first routes are created; add explicit rewrites only if catch-all doesn't match.

### Phase 1 File Structure

```
src/services/
  rostering/
    types.ts                    # RosterTask, ContactAttempt, AuditEntry, enums
    roster-task-service.ts      # CRUD for roster tasks
    workflow-orchestrator.ts    # State machine: advanceTask()
    trigger-detector.ts         # Identifies new shifts needing filling
    urgency-classifier.ts      # planned vs urgent
    cascade-engine.ts           # Sequential/parallel contact strategies
    index.ts
  reasoning/
    types.ts                    # LLMRecommendation, prompt types
    prompts.ts                  # System prompt, context template builder
    reasoning-service.ts        # Calls Bedrock, parses structured output
    parse-response.ts           # JSON extraction + validation
    index.ts
  communication/
    types.ts                    # Channel types, message templates, response types
    dispatcher.ts               # Route messages to correct channel
    sms-provider.ts             # Twilio/SNS (SMSProvider interface + impl)
    email-provider.ts           # SendGrid/SES (EmailProvider interface + impl)
    response-handler.ts         # Process inbound responses
    templates.ts                # Shift offer, confirmation, cancellation templates
    webhook-verification.ts     # Reusable webhook signature verification (Twilio, AlayaCare)
    index.ts

app/
  (app)/
    dashboard/page.tsx          # Enhanced with live activity feed
    roster/
      page.tsx                  # Active roster tasks list
      [id]/page.tsx             # Task detail + audit trail
    escalations/page.tsx        # Escalation queue
    analytics/page.tsx          # 30-day metrics dashboard
    chat/page.tsx               # Conversational interface (reinstated)
  api/v1/
    roster/tasks/route.ts       # POST + GET (list)
    roster/tasks/[id]/route.ts  # GET (detail) + PATCH (actions)
    roster/escalations/route.ts
    roster/analytics/route.ts
    roster/audit/route.ts
    webhooks/alayacare/route.ts
    webhooks/sms/route.ts
    webhooks/email/route.ts

components/rostering/
    activity-feed.tsx           # Live task activity stream
    task-card.tsx               # Roster task summary card
    task-detail.tsx             # Full task view with audit trail
    escalation-card.tsx         # Escalation queue item
    candidate-list.tsx          # Scored candidates with assign actions
    score-bar.tsx               # Visual score indicator
    audit-timeline.tsx          # Chronological audit entry display
    analytics-charts.tsx        # 30-day metric visualisations
```

### Phase 1 Dependencies & Prerequisites

| Dependency | Required For | Status |
|-----------|-------------|--------|
| PoC 1 scoring engine | Scoring step in orchestrator | Architecture designed, not yet implemented |
| PoC 2 LLM validation | Reasoning prompts and escalation criteria | Not started |
| SMS provider account (Twilio or AWS SNS) | SMS notifications | Not set up |
| Email provider account (SendGrid or AWS SES) | Email parsing and sending | Not set up |
| AlayaCare webhook access | Real-time trigger detection | Not available (sandbox pending) |
| Database migration for new tables | Task persistence and audit logging | Not created |

### Phase 1 Implementation Sprints (Est. 16 weeks / 8 two-week sprints)

#### Sprint P1.1: Foundation — Task Persistence & Orchestrator Core (2 weeks)

| Task | Req | Description |
|------|-----|-------------|
| P1.1.1 | — | **Database migration** — Define `rosterTasks`, `rosterAuditLog`, `rosterDailyMetrics` in `src/db/schema.ts` using `pgTable()` (matching existing pattern). Generate migration via `bun run db:generate`. Add RLS policies (see schema above). Export `$inferSelect`/`$inferInsert` types |
| P1.1.2 | — | **Rostering types** — `src/services/rostering/types.ts`: `RosterTask`, `ContactAttempt`, `AuditEntry`, `RosterTaskStatus` |
| P1.1.3 | — | **Roster task service** — `roster-task-service.ts`: CRUD following existing `(tx, userId, ...)` pattern |
| P1.1.4 | — | **Orchestrator state machine** — `workflow-orchestrator.ts`: `advanceTask()` pipeline: detected → gathering → scoring → reasoning → contacting → ... (P1 decision: one state transition per invocation, state persisted to DB) |
| P1.1.5 | — | **Urgency classifier** — `urgency-classifier.ts`: <4hrs = urgent, "URGENT" flag = urgent, else planned. Urgency selects weight preset + cascade strategy + expiry window + escalation threshold (P6 decision) |
| P1.1.6 | — | **Audit logging** — append-only audit entries for every state transition (P4 decision) |
| P1.1.7 | — | **API routes** — `POST/GET /api/v1/roster/tasks`, `GET /api/v1/roster/tasks/[id]` |
| P1.1.8 | — | **Roster task hook** — `use-roster-tasks.ts`: TanStack Query hooks for task CRUD |
| P1.1.9 | — | **Data validation** — `validateMatchInputs()`: pre-flight checks in GATHERING → SCORING transition. Blockers (no client_id, no employees) → skip scoring, escalate immediately with validation report. Warnings (missing coords, past start time) → score with available data, attach to MatchResult |

**Deliverables:** State machine advancing through scoring + reasoning with task persistence. Data validation prevents bad scoring inputs. No communication yet (dry-run mode). 3 API routes + client hook.

#### Sprint P1.2: LLM Reasoning Service (2 weeks)

| Task | Req | Description |
|------|-----|-------------|
| P1.2.1 | P1.4 | **Reasoning service** — `src/services/reasoning/reasoning-service.ts`: wraps PoC 2 prompts into `getRecommendation()` calling existing Bedrock client at temperature 0.3. Input: `MatchResult` + visit/client context + urgency |
| P1.2.2 | P1.4 | **Response parser** — `parse-response.ts`: extract and validate `LLMRecommendation` JSON schema from LLM output (structured JSON, not function calling — works across providers) |
| P1.2.3 | P1.5 | **Escalation flow** — route based on `should_escalate` + `urgency`: immediate → ESCALATED (skip contact), before_shift → CONTACTING with flag (try contact + alert human), informational → CONTACTING with note |
| P1.2.4 | P1.6 | **Explainable recommendations** — `primary.explanation` field populated with NL reasoning; `factors_considered` and `trade_offs` arrays |

**Deliverables:** `src/services/reasoning/` complete (5 files). Orchestrator integrates scoring → reasoning → escalation decision.

#### Sprint P1.3: SMS Communication (2 weeks)

| Task | Req | Description |
|------|-----|-------------|
| P1.3.1 | P1.8 | **SMS provider interface** — `SMSProvider` abstraction (P3 decision) with Twilio implementation in `sms-provider.ts` |
| P1.3.2 | P1.8 | **Communication dispatcher** — `dispatcher.ts`: route ContactAttempt to SMS channel based on caregiver preference |
| P1.3.3 | P1.8 | **SMS templates** — `templates.ts`: shift offer template with accept/decline links + expiry ("Hi {name}, shift available: {client} on {date} {time}. Reply YES to accept or NO to decline.") |
| P1.3.4 | P1.9 | **Webhook verification utility** — `src/services/communication/webhook-verification.ts`: reusable `verifyWebhookSignature(provider, req)` supporting Twilio signature validation. This sets the pattern for AlayaCare webhook verification in P1.6.2 |
| P1.3.5 | P1.9 | **Inbound SMS webhook** — `POST /api/v1/webhooks/sms` receiving Twilio callbacks, verified via webhook-verification utility |
| P1.3.6 | P1.9 | **Response handler** — `response-handler.ts`: LLM-parsed conversational SMS responses (not just YES/NO — handles accept/decline/question; questions trigger follow-up conversation) |
| P1.3.7 | — | **Expiry handling** — mark ContactAttempt as expired after timeout (2hrs planned / 20min urgent), advance task to CASCADING |

**Deliverables:** Full SMS loop: send offer → receive response → advance task. Expiry triggers cascade. Webhook verification pattern established. `src/services/communication/` foundation (8 files).

#### Sprint P1.4: Cascade Engine & Operations Dashboard (2 weeks)

| Task | Req | Description |
|------|-----|-------------|
| P1.4.1 | P1.10 | **Sequential cascade** — `cascade-engine.ts`: contact #1, wait expiry (2hrs), contact #2, ... One at a time to avoid over-offering |
| P1.4.2 | P1.10 | **Parallel cascade** — contact top 5 simultaneously, first accept wins, cancel others immediately |
| P1.4.3 | P1.10 | **Escalation trigger** — after top 10 (sequential) or 15min (parallel), escalate to human |
| P1.4.4 | P1.17 | **Operations dashboard** — `components/rostering/activity-feed.tsx`: live activity feed of active roster tasks with status. Data: `use-roster-tasks.ts` list query filtered by active status with `refetchInterval: 10_000` (polling, not Supabase Realtime — per deferred architecture items) |
| P1.4.5 | P1.17 | **Dashboard metrics** — active tasks, time-to-fill avg, fill rate today |

**Deliverables:** Full cascade logic for planned + urgent shifts. Dashboard shows real-time task status.

#### Sprint P1.5: Escalation Console & Assignment Write-Back (2 weeks)

| Task | Req | Description |
|------|-----|-------------|
| P1.5.1 | P1.18 | **Escalation console UI** — `app/(app)/escalations/page.tsx`: prioritised queue with task detail, LLM recommendation, scored candidates, contact history |
| P1.5.2 | P1.18 | **Human actions** — accept recommendation (→ CONTACTING), assign manually (bypass LLM), defer (keep in queue), take over (exit autonomous flow) |
| P1.5.3 | P1.11 | **AlayaCare write-back** — on acceptance: `POST /scheduler/visits/{id}/offers` via `alayaFetch` + audit entry (P8 decision: entity data stays in AlayaCare) |
| P1.5.4 | P1.12 | **Escalation auto-triggers** — no acceptance after N attempts, high-priority client, compliance concern, <3 candidates |
| P1.5.5 | — | **PATCH route** — `PATCH /api/v1/roster/tasks/[id]` for human actions + `GET /api/v1/roster/escalations` |

**Deliverables:** Humans can intervene via escalation console. Accepted shifts written back to AlayaCare. 2 new API routes.

**Known gap:** No policy layer for escalation actions (accept, assign, take over). Any authenticated user can perform any action. Acceptable for single-user MVP. Revisit when multi-user support is added — extend `makeDeps()` with roster policies at that point.

#### Sprint P1.6: AlayaCare Webhooks & Email Integration (2 weeks)

| Task | Req | Description |
|------|-----|-------------|
| P1.6.1 | P1.7 | **Webhook receiver** — `POST /api/v1/webhooks/alayacare` handling: `new_visit` (status=vacant → create RosterTask), `visit_cancelled` (cancel active task → notify contacted caregivers), `visit_modified` (re-score if material change), `availability_changed` (re-score affected tasks), `clock_in/clock_out` (update task status → log outcome) |
| P1.6.2 | P1.7 | **Webhook signature verification** — validate AlayaCare webhook signatures (P7 decision: webhook-first, polling-fallback) |
| P1.6.3 | P1.13 | **Email provider** — `EmailProvider` abstraction (P3 decision) with SendGrid/SES implementation in `email-provider.ts` |
| P1.6.4 | P1.14 | **Inbound email parsing** — LLM extracts shift details from free-text handover emails → creates confirmation email → on human confirmation → creates RosterTask |
| P1.6.5 | P1.14 | **Outbound email** — daily shift summary, weekly report |
| P1.6.6 | — | **Trigger detector** — `trigger-detector.ts`: polling fallback for when webhooks are unavailable — scheduled job checks for new/modified visits. **Scheduling mechanism:** Vercel Cron (if deployed on Vercel) or Supabase `pg_cron` (database-level). Same mechanism used for P1.7.3 (daily metrics) and P1.8.2 (pattern recognition). Decision on provider made at sprint start based on deployment target |

**Deliverables:** Automatic trigger detection from AlayaCare (webhook + polling fallback). Email-based shift handover flow. Scheduling mechanism established for all cron tasks. 2 new webhook routes.

#### Sprint P1.7: Audit Trail, Analytics & Conversational UI (2 weeks)

| Task | Req | Description |
|------|-----|-------------|
| P1.7.1 | P1.19 | **Audit trail UI** — `app/(app)/roster/[id]/page.tsx` + `components/rostering/audit-timeline.tsx`: searchable log filterable by task/visit/employee/date (query interface: `AuditQuery` with task_id, visit_id, employee_id, action, actor, date range) |
| P1.7.2 | P1.20 | **Analytics dashboard** — `app/(app)/analytics/page.tsx` + `components/rostering/analytics-charts.tsx`: 30-day metrics: autonomous fill rate, time-to-fill, acceptance rate, escalation rate, agent vs human performance, fill rate by shift type |
| P1.7.3 | P1.20 | **Daily metrics materialisation** — scheduled job populating `roster_daily_metrics` from completed tasks. Uses scheduling mechanism established in P1.6.6 |
| P1.7.4 | P1.21 | **Conversational interface (read-only)** — `app/(app)/chat/page.tsx` (reinstated): extends existing chat infrastructure (`src/lib/llm/`, `src/lib/sse.ts`) with rostering-specific LLM tool use for **read-only queries** only: availability checks ("Is Sarah available Thursday?"), task status queries, candidate lookups. Write actions (create task, assign caregiver via chat) deferred to P1.8 to manage sprint scope |
| P1.7.5 | — | **API routes** — `GET /api/v1/roster/analytics`, `GET /api/v1/roster/audit` |

**Deliverables:** Full transparency and analytics. Chat-based task management. 2 new API routes.

#### Sprint P1.8: Learning, Polish & Launch Preparation (2 weeks)

| Task | Req | Description |
|------|-----|-------------|
| P1.8.1 | P1.16 | **Outcome tracking** — record every task: caregivers contacted + responses, time to fill, human intervention required, post-assignment outcomes (via AlayaCare: attendance, incidents) |
| P1.8.2 | P1.16 | **Pattern recognition** — scheduled analysis: caregivers who always decline certain shifts (by time bucket), anomalous availability (available but 0% acceptance), preset performance comparison, client churn (unique caregivers / total visits) |
| P1.8.3 | P1.16 | **Acceptance feedback loop** — supplement PoC 1 acceptance scorer with DappaAi's own contact outcomes (initial: AlayaCare historical → Phase 1: DappaAi outcomes → future: weight recent data higher) |
| P1.8.4 | P1.21 | **Conversational write actions** — extend P1.7.4 chat with LLM tool use for write operations: create roster task via chat ("Find urgent carer for Epping tomorrow 2pm"), assign caregiver ("Assign Tom to Friday shift"). Requires confirmation step before executing |
| P1.8.5 | — | **End-to-end testing** — full workflow tests across all trigger types (webhook, email, manual, conversational) |
| P1.8.6 | — | **Performance & load testing** — validate with realistic employee pool sizes (150+ candidates) |
| P1.8.7 | — | **Production deployment prep** — real credentials, sandbox → production URL, rate limit strategy, monitoring, alerting |

**Deliverables:** Learning system active. Full E2E test suite. Production deployment package.

---

## Sandbox Transition Checkpoint

When AlayaCare sandbox access arrives (from Dovida), insert this checkpoint regardless of current sprint:

| Step | Duration | Action |
|------|----------|--------|
| 1. Contract validation | 0.5 day | Compare mock-alaya response shapes against real API; document drift |
| 2. Auth verification | 0.5 day | Confirm Basic auth works; test credential rotation |
| 3. Data survey | 0.5 day | Assess real data quality: null rates, data completeness, edge cases |
| 4. Endpoint sweep | 0.5 day | Hit all endpoints (including scoring-relevant: skills, offers); verify pagination, filtering, errors |
| 5. Mock update | 0.5–1 day | Update mock-alaya to match any contract differences discovered |
| 6. Re-run tests | 0.5 day | Run existing test suite against sandbox; fix any failures |

**Total:** 2–3 days. Can run in parallel with other sprint work if managed carefully.

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| **Sandbox access delayed** | Medium | Medium | Mock-first strategy means PoC 1 & 2 can complete without sandbox; contract validation deferred |
| **Real API response shapes differ from mock** | Medium | High | Contract validation checkpoint; keep mock-alaya updatable; TypeScript types as contract |
| **AlayaCare rate limits block bulk queries** | Medium | Medium | Batch fetch strategy in orchestrator; cache employee/skills data; document limits |
| **Scoring accuracy insufficient** | Low | High | 5 configurable weight presets; whitepaper provides alternative algorithms (TOPSIS, PROMETHEE) for future upgrade |
| **LLM hallucination / inconsistent reasoning** | Medium | Medium | Structured JSON output with validation; temperature 0.3; recommendations validated against scored data |
| **Missing geo data for proximity scoring** | High | Low | Hard constraint filter + graceful degradation: null coords → score 0, confidence "low", warning |
| **Domain expertise unavailable for baselines** | Medium | High | Create best-guess baselines; flag assumptions; iterate when expert input available |
| **LLM cost at scale** | Low | Medium | Compare providers in Sprint 5; Haiku 4.5 already cost-efficient; cache similar scenarios |
| **SMS provider delivery issues** | Low | Medium | Provider abstraction (P3 decision) allows swapping Twilio ↔ SNS; retry logic in dispatcher |
| **AlayaCare webhooks unavailable** | Medium | Medium | Polling fallback via `trigger-detector.ts` (P7 decision); scheduled job checks for new/modified visits |
| **Next.js serverless execution limits** | Low | Medium | Async pipeline design (P1 decision): one state transition per invocation, state persisted to DB between steps |
| **Caregiver SMS response parsing** | Low | Medium | LLM-parsed conversational responses (not just YES/NO); validation against scored data; fallback to explicit accept/decline prompt |
| **JSONB schema evolution** | Low | Low | Flexible storage (P5 decision) enables iteration without migrations; risk is query complexity — mitigated by TypeScript types as contract |

---

## Timeline Summary

### PoC Phase (Weeks 1–8)

| Sprint | Focus | Est. Duration | Cumulative |
|--------|-------|---------------|------------|
| Pre-Sprint | Mock data verification | 0.5 day | 0.5 days |
| Sprint 1 | Scoring algorithm (5 dimensions + constraints + orchestrator) | 3–4 days | ~1 week |
| Sprint 2 | Match endpoint + UI + data validation | 2–3 days | ~1.5 weeks |
| Sprint 3 | Workflows + edge cases | 2–3 days | ~2 weeks |
| Sprint 4 | Scenario testing + PoC 1 deliverable | 2–3 days | ~2.5 weeks |
| **PoC 1 Gate** | | | |
| Sprint 5 | Scenarios + prompt engineering | 3–4 days | ~3.5 weeks |
| Sprint 6 | Escalation logic + evaluation | 3–4 days | ~4.5 weeks |
| Sprint 7 | Integration + PoC 2 deliverable | 2–3 days | ~5 weeks |
| **PoC 2 Gate** | | | |
| Sandbox | Contract validation (when available) | 2–3 days | Parallel |

**PoC total: 5–6 weeks** (within the 8-week window from requirements).

### Phase 1 MVP (Weeks 9–24)

| Sprint | Focus | Est. Duration |
|--------|-------|---------------|
| P1.1 | Task persistence + orchestrator core | 2 weeks |
| P1.2 | LLM reasoning service | 2 weeks |
| P1.3 | SMS communication | 2 weeks |
| P1.4 | Cascade engine + operations dashboard | 2 weeks |
| P1.5 | Escalation console + write-back | 2 weeks |
| P1.6 | Webhooks + email integration | 2 weeks |
| P1.7 | Audit trail + analytics + conversational UI | 2 weeks |
| P1.8 | Learning + polish + launch prep | 2 weeks |

**Phase 1 total: 16 weeks** (within the 16-week window from requirements).

**Combined total: ~21–22 weeks** with buffer.

---

## Deliverables Checklist

### PoC 1 Deliverables (per requirements)

- [x] Technical architecture document — AlayaCare integration approach
- [x] Working scoring prototype — 5 dimensions with configurable weights + hard constraint filter
- [x] Validation results — 30+ scenarios scored and compared across all 5 presets
- [x] API capability matrix — what's achievable, what's not
- [x] Identified limitations with workarounds
- [x] Security and compliance requirements
- [x] Estimated integration effort for Phase 1

### PoC 2 Deliverables (per requirements)

- [x] LLM performance metrics — accuracy by scenario category
- [x] Recommended LLM provider and approach
- [x] Escalation criteria tuning recommendations
- [x] Example decision explanations
- [x] Integration pathway for Phase 1 agent logic

### Phase 1 MVP Deliverables

- [x] Database migration — 3 new tables (`roster_tasks`, `roster_audit_log`, `roster_daily_metrics`) with RLS
- [x] Workflow orchestrator — `advanceTask()` state machine with 11 states (P1 async pipeline)
- [x] Urgency classifier — planned/urgent drives weight preset, cascade, expiry, escalation (P6)
- [x] LLM reasoning service — `getRecommendation()` wrapping Bedrock at temperature 0.3 with `LLMRecommendation` structured output
- [x] SMS communication — `SMSProvider` abstraction (P3) + mock Twilio impl + conversational response parsing
- [x] Cascade engine — sequential (2hr expiry) + parallel (20min expiry) strategies
- [x] Escalation console — prioritised queue with accept/assign/defer/take-over actions
- [x] AlayaCare write-back — `POST /scheduler/visits/{id}/offers` on acceptance (P8)
- [x] AlayaCare webhook receiver — 5 event types: new_visit, cancelled, modified, availability, clock (P7)
- [x] Polling fallback — `trigger-detector.ts` for when webhooks unavailable (P7)
- [x] Email integration — `EmailProvider` abstraction (P3) + inbound LLM parsing + outbound reports
- [x] Operations dashboard — live activity feed + metrics (active tasks, time-to-fill, fill rate)
- [x] Audit trail — append-only log (P4) with searchable UI, filterable by task/visit/employee/date
- [x] Analytics dashboard — 30-day rolling metrics + `roster_daily_metrics` materialisation
- [x] Conversational interface — LLM tool use: read-only queries (P1.7) + write actions with confirmation (P1.8)
- [x] Learning system — outcome tracking + pattern recognition + acceptance feedback loop
- [x] Data validation — `validateMatchInputs()` pre-flight checks in P1.1 (blockers → escalate, warnings → attach)
- [x] Webhook verification — reusable `validateWebhookSecret()` utility (M2M auth in webhook route)
- [ ] Scheduling mechanism — Vercel Cron or `pg_cron` for polling fallback + metrics + pattern recognition (deferred to production cutover)
- [x] 7 new API routes (roster CRUD + escalation + audit + analytics + summary + process-events)

---

## Tracking

Progress tracked via `docs/poc-traceability.md`. Update status after each sprint:
- Mark requirements as DONE when fully implemented and tested
- Update implementation column with file paths
- Adjust summary counts

Sprint reviews: demo completed functionality against traceability matrix. Each sprint should move 3–5 requirements from NOT STARTED/PARTIAL to DONE.

### Document Cross-References

| Document | Purpose | Key Sections Referenced | When to Update |
|----------|---------|------------------------|----------------|
| `docs/poc-traceability.md` | Requirement → implementation mapping | R2.x, R3.x, P1.x requirement IDs | After each sprint |
| `docs/plans/scoring-engine-plan.md` | Sprint 1–2 detailed tasks + reconciliation decisions (G1–G9) | §1.2 (divergence table), §5 (task breakdown) | When scoring implementation begins |
| `docs/scoring-engine-architecture.md` | Scoring engine design spec | Scorer algorithms, type definitions | After Sprint 2 (reflect final implementation) |
| `docs/scoring-engine-whitepaper.md` | Algorithm research + future evolution | Weight presets, constraint filter, MCDM methods | Reference only (not updated during PoC) |
| `docs/phase1-rostering-architecture.md` | Phase 1 MVP system design (P1–P8 decisions) | §1 State machine, §2 LLM layer, §3 Comms, §5 UI, §6 Schema, §7 API routes | After each Phase 1 sprint |
| `docs/ARCHITECTURE.md` | Master architecture overview | Project structure, key patterns | After each milestone |
| `docs/features.md` | Feature inventory | Feature status tracking | After each sprint |
