# PoC 1 Technical Deliverable: AlayaCare API Integration & Scoring Dimensions

Formal technical architecture document for PoC 1. Validates technical feasibility of deep read/write integration with AlayaCare's API and prototypes core scoring dimensions for caregiver matching.

**Date:** 2026-03-11
**Status:** Complete (Sprints 1–4)

---

## Executive Summary

PoC 1 demonstrates that DappaAi AI can:

1. **Read and write** to AlayaCare's API (6 GET + 2 POST endpoints, authenticated, error-handled)
2. **Calculate match scores** across 5 dimensions for 150+ caregiver profiles against 55 test visits
3. **Filter ineligible candidates** via hard constraints (qualifications + schedule conflicts)
4. **Rank caregivers** using configurable weight presets for different rostering scenarios
5. **Assess match confidence** using distribution-based analysis

The scoring engine has been validated against **32 test scenarios across 6 categories**, with all scenarios producing expected outcomes. The integration pathway to production is documented and estimated at ~30 engineering hours (~1 sprint).

---

## 1. Integration Approach

### 1.1 Architecture

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Browser    │────▶│   Next.js API    │────▶│   AlayaCare     │
│   (React)    │◀────│   Routes (v1)    │◀────│   REST API      │
│              │     │                  │     │                 │
│  TanStack    │     │  Auth + Proxy    │     │  Basic Auth     │
│  Query       │     │  + Scoring       │     │  (key pair)     │
└─────────────┘     └──────────────────┘     └─────────────────┘
```

**Pattern:** Server-side proxy. All AlayaCare API calls are made from Next.js API routes, never from the browser. This keeps API credentials server-side and allows centralised error handling.

### 1.2 API Capability Matrix

| AlayaCare Entity | Read | Write | Endpoint | API Route |
|-----------------|------|-------|----------|-----------|
| Clients (care recipients) | GET list + search | — | `/patients/clients` | `/api/v1/alaya-clients` |
| Employees (caregivers) | GET list + search | — | `/employees/employees` | `/api/v1/employees` |
| Employee Skills | GET by employee | — | `/employees/employees/{id}/skills` | `/api/v1/employees/[id]/skills` |
| Skills (reference) | GET full list | — | `/employees/skills` | `/api/v1/skills` |
| Visits (shifts) | GET filtered list | POST create | `/scheduler/visits` | `/api/v1/visits` |
| Visit detail | GET single | — | `/scheduler/visits/{id}` | `/api/v1/visits/[id]` |
| Visit Offers | GET by visit | POST create | `/scheduler/visits/{id}/offers` | `/api/v1/visits/[id]/offers` |

All routes are authenticated via `requireAuthContext(req, traceId)` and return structured error envelopes with `traceId`.

### 1.3 Client-Side Hooks

| Hook | Purpose | Caching |
|------|---------|---------|
| `useAlayaClients(search?, status?)` | Paginated client search | 30s stale time |
| `useEmployees(search?, status?)` | Paginated employee search | 30s stale time |
| `useEmployeeSkills(employeeId)` | Skills for employee | Conditional on ID |
| `useSkills()` | Reference skill catalog | 5min stale time |
| `useVisits(options?)` | Visits with filters | 30s stale time |
| `useVisit(visitId)` | Single visit detail | Conditional on ID |
| `useVisitOffers(visitId)` | Offers for visit | Conditional on ID |
| `useMatch(visitId, options?)` | POST-based scoring | On-demand |
| `useCreateVisit()` | Mutation + invalidation | — |
| `useCreateOffer()` | Mutation + invalidation | — |

---

## 2. Scoring Engine

### 2.1 Algorithm

**Weighted Sum Model (WSM)** across 5 normalised dimensions:

```
overall = Σ(dimension_score × weight)    where score ∈ [0, 1]
```

### 2.2 Scoring Dimensions

| Dimension | Algorithm | Range | Confidence Logic |
|-----------|-----------|-------|-----------------|
| **Skills match** | `valid_matched / required_count` | [0, 1] | Low if no requirements; High otherwise |
| **Relationship history** | `ln(count+1)/ln(20) × recency_multiplier` | [0, 1] | Low <3 visits, Medium 3–9, High 10+ |
| **Geographic proximity** | `max(0, 1 - haversine_km / 50)` | [0, 1] | Low if coordinates missing |
| **Workload balance** | `exp(-0.5 × z²)` with 1.5× overload penalty | [0, 1] | Medium if zero variance |
| **Acceptance likelihood** | `accepted / (accepted + declined)` | [0, 1] | Low <3 offers, Medium 3–9, High 10+ |

### 2.3 Weight Presets

| Preset | Skills | Relationship | Proximity | Workload | Acceptance | Use Case |
|--------|--------|-------------|-----------|----------|-----------|----------|
| **planned** | 0.20 | 0.30 | 0.15 | 0.20 | 0.15 | Standard — continuity + balance |
| **urgent** | 0.15 | 0.10 | 0.25 | 0.10 | 0.40 | Quick fills — acceptance priority |
| **high_value_client** | 0.15 | 0.35 | 0.15 | 0.10 | 0.25 | VIP — proven track record |
| **new_client** | 0.25 | 0.05 | 0.20 | 0.25 | 0.25 | New client — experienced carers |
| **efficiency** | 0.15 | 0.10 | 0.30 | 0.30 | 0.15 | Ops — minimise travel + balance |

Custom weights are also supported (must sum to 1.0, validated via Zod).

### 2.4 Hard Constraint Filter

Before scoring, ineligible employees are removed:

1. **Required qualifications:** Employee must hold ALL required skills (non-expired)
2. **Schedule conflicts:** No overlapping visits (interval overlap detection)

Adjacent shifts (end time = start time) do not conflict.

### 2.5 Match Confidence

Distribution-based confidence assessment:

| Level | Criteria |
|-------|----------|
| **High** | Top score >0.75, gap to #2 >0.10, all dimensions high confidence, 3+ candidates |
| **Medium** | Top 0.50–0.75, or gap ≤0.10, or any dimension low confidence |
| **Low** | Top <0.50, or <3 eligible candidates, or empty pool |

### 2.6 Data Quality Warnings

The engine generates per-match warnings:
- Visit has no client assigned
- X employees missing coordinates
- X employees have no skills on file
- Client missing coordinates — proximity unavailable
- Visit has no required skills defined
- No eligible employees after hard constraint filtering

---

## 3. Scoring Validation Results

### 3.1 Test Scenarios

32 scenarios across 6 categories, all expectations met (32/32):

| Category | Count | Scenarios |
|----------|-------|-----------|
| **Straightforward Matches** | 5 | Clear winner, tight race, workload differentiator, single candidate, large pool |
| **Multi-Qualified Candidates** | 5 | All qualified, partial filtered, no requirements, expiring-soon, 5-requirement filter |
| **Rural / Sparse Pools** | 5 | Beyond 50km, 2 candidates, proximity differentiation, null coords, client missing coords |
| **Urgent vs Planned Presets** | 6 | Urgent (acceptance wins), Planned (relationship wins), Efficiency, High-value, New-client, Custom weights |
| **New vs Established Clients** | 5 | New client (zero relationship), established (continuity), stale relationship, no client, confidence tiers |
| **Hard Constraint Edge Cases** | 6 | All filtered, schedule conflict, adjacent shifts, expired skills, multiple failures, no requirements |

### 3.2 Key Findings

1. **Weight presets produce distinct rankings:** The same candidate pool produces different #1 picks across presets (validated by P1–P5 scenarios). Urgent preset correctly prioritises high-acceptance employees; Planned preset correctly prioritises relationship continuity.

2. **Hard constraints correctly exclude ineligible candidates:** Missing skills, expired qualifications, and schedule conflicts all filter correctly. Adjacent shifts (boundary-touching) correctly pass.

3. **Data quality gracefully degrades:** Missing coordinates, absent skills, null client IDs all produce 0-score/low-confidence results instead of errors. Warnings are generated for rostering staff awareness.

4. **Confidence tiers align with data completeness:** Scenarios with sparse data (few candidates, missing dimensions) correctly produce "low" confidence. Well-populated scenarios with clear winners produce "high" confidence.

5. **Custom weights override presets correctly:** 100% skills-weight produces identical scores for identically-skilled candidates regardless of other dimensions.

### 3.3 Comparison Report

Full results available in `docs/comparison-report.json` — machine-readable JSON with per-scenario rankings, dimension breakdowns, confidence levels, and data warnings.

---

## 4. Limitations & Workarounds

### 4.1 Known Limitations

| Limitation | Impact | Documented In |
|-----------|--------|---------------|
| No webhook integration | No real-time status updates | `poc1-edge-cases.md` §2.3 |
| Rate limits untested | Burst requests may be throttled | `poc1-edge-cases.md` §2.4 |
| N+1 skill queries | 150+ requests per scoring | `poc1-edge-cases.md` §2.2 |
| Single-page pagination | Large pools may be truncated | `poc1-edge-cases.md` §2.1 |
| No employee preferences API | Preferences not factored | `poc1-workarounds.md` §2.2 |
| No scoring audit trail | Decisions not persisted | `poc1-workarounds.md` §2.5 |

### 4.2 Manual Workarounds Required

| Workaround | Frequency | Documented In |
|-----------|-----------|---------------|
| Ensure employee/client coordinates in AlayaCare | Setup + ongoing | `poc1-workarounds.md` §1.1–1.2 |
| Assign required skills to visits | Per visit creation | `poc1-workarounds.md` §1.3 |
| Manual offer cascade on decline | Per declined offer | `poc1-workarounds.md` §1.4 |
| Re-score before offer if results >15 min old | Per assignment | `poc1-workarounds.md` §1.5 |

Full details: [`poc1-workarounds.md`](./poc1-workarounds.md)

---

## 5. Security Requirements

### 5.1 Current Security Posture

| Area | Status | Details |
|------|--------|---------|
| Authentication (user → DappaAi) | Done | Supabase Auth, cookie + Bearer |
| Authentication (DappaAi → AlayaCare) | Done | Basic Auth, server-side only |
| Route protection | Done | All routes require auth |
| Request traceability | Done | traceId on all requests |
| Input validation | Done | Zod schemas on match/availability |
| Error handling | Done | Structured envelopes, no internal leak |
| Information disclosure prevention | Done | Generic error messages to client |

### 5.2 Production Security Requirements

| Requirement | Priority | Effort |
|-------------|----------|--------|
| RBAC (role-based access control) | P1 | 8 hours |
| Per-resource authorization | P1 | 4 hours |
| API credential rotation | P1 | 4 hours |
| Scoring audit trail | P2 | 8 hours |
| Rate limiting (internal) | P2 | 4 hours |

Full details: [`poc1-security-assessment.md`](./poc1-security-assessment.md)

---

## 6. Production Pathway

### 6.1 Summary

The PoC integration pattern (server-side proxy + scoring engine) maps directly to production. Key changes:

1. **Credentials:** Production AlayaCare API keys via secrets manager
2. **URL:** Tenant-specific AlayaCare URL
3. **Caching:** Employee skills cache (15-min TTL) reduces requests by ~97%
4. **Rate limiting:** Request queue + retry logic
5. **Monitoring:** API health alerts + scoring performance metrics

### 6.2 Effort Estimate

| Work Item | Effort |
|-----------|--------|
| Credential + URL setup | 2 hours |
| Endpoint verification | 4 hours |
| Rate limiting + retry | 4 hours |
| Skills caching | 4 hours |
| Monitoring + alerts | 4 hours |
| Pagination support | 4 hours |
| Load testing | 4 hours |
| Visit status validation | 2 hours |
| **Total** | **~30 hours (~1 sprint)** |

Full details: [`poc1-production-pathway.md`](./poc1-production-pathway.md)

---

## 7. Phase 1 MVP Effort Estimate

Based on PoC findings, the Phase 1 MVP (per `phase1-rostering-architecture.md`) requires:

| Feature Area | Key Components | Estimated Effort |
|-------------|---------------|-----------------|
| **Production AlayaCare integration** | Caching, rate limiting, pagination, monitoring | 1 sprint |
| **LLM reasoning layer** (PoC 2) | Prompt engineering, provider evaluation, structured output | 2 sprints |
| **Autonomous workflow** | Cascade logic, offer management, escalation | 2 sprints |
| **Communication** | SMS/email notifications, AlayaCare app integration | 1–2 sprints |
| **Human-in-the-loop** | Operations dashboard, escalation console, audit trail | 2 sprints |
| **Testing & hardening** | E2E tests, load tests, security hardening | 1 sprint |
| **Total Phase 1 estimate** | | **~9–10 sprints (9–12 weeks)** |

---

## 8. Test Coverage

| Category | Files | Tests |
|----------|-------|-------|
| Scoring engine unit tests | 9 | 63 |
| Scoring scenario tests | 1 | 32 |
| Comparison report | 1 | 32 |
| Endpoint integration tests | 3 | 22 |
| Hook tests | 2 | 8 |
| Fixture validation | 1 | 17 |
| Other unit tests | 8 | 71 |
| **Total** | **25** | **245** |

---

## 9. Documentation Index

| Document | Purpose |
|----------|---------|
| [`scoring-engine-architecture.md`](./scoring-engine-architecture.md) | Scoring algorithm design decisions |
| [`poc1-edge-cases.md`](./poc1-edge-cases.md) | Data quality issues, API limitations, error scenarios |
| [`poc1-workarounds.md`](./poc1-workarounds.md) | Manual steps required, API gaps |
| [`poc1-production-pathway.md`](./poc1-production-pathway.md) | Production deployment plan |
| [`poc1-security-assessment.md`](./poc1-security-assessment.md) | Security posture and requirements |
| [`comparison-report.json`](./comparison-report.json) | Machine-readable scoring validation results |
| [`poc-traceability.md`](./poc-traceability.md) | Requirements → implementation mapping |
| [`phase1-rostering-architecture.md`](./phase1-rostering-architecture.md) | Phase 1 autonomous rostering design |

---

## 10. PoC 1 Success Criteria Verification

| Criterion | Status | Evidence |
|-----------|--------|---------|
| All critical read/write operations via API | **PASS** | 6 GET + 2 POST + match + availability endpoints |
| Match scores for 30+ scenarios | **PASS** | 32 scenarios, 32/32 expectations met |
| Hard constraints filter ineligible | **PASS** | 6 constraint edge case scenarios validated |
| Manual workarounds documented | **PASS** | `poc1-workarounds.md` — 5 manual steps, 6 API gaps |
| Security requirements understood | **PASS** | `poc1-security-assessment.md` — 5 production requirements |
| Production pathway clear | **PASS** | `poc1-production-pathway.md` — 30-hour estimate |
