# PoC 1: Manual Workarounds & API Gaps

Formal documentation of manual steps, data unavailable via API, and workarounds required for production use. Companion to `poc1-edge-cases.md`.

**Last updated:** 2026-03-11

---

## 1. Manual Steps Required

### 1.1 Employee Coordinate Entry

**Gap:** Employee coordinates (`latitude`, `longitude`) are optional in AlayaCare. ~7% of employees have null coordinates in test data.

**Manual step:** Rostering staff must ensure all active employee profiles have valid coordinates in AlayaCare before scoring will produce meaningful proximity results.

**Impact if skipped:** Proximity scorer returns 0.0 with low confidence. These employees rank lower on proximity-weighted presets (efficiency, urgent) but are still eligible on other dimensions.

### 1.2 Client Coordinate Entry

**Gap:** Same as above for client profiles.

**Manual step:** Client address must be geocoded in AlayaCare. If missing, all proximity scoring is disabled for visits to that client.

### 1.3 Required Skills Assignment on Visits

**Gap:** 9% of test visits have no `required_skill_ids`. Without required skills, the skills dimension provides no differentiation — all candidates score 1.0 with low confidence.

**Manual step:** Rostering coordinator must assign required skills when creating visits in AlayaCare. This is a data quality issue, not an API limitation.

### 1.4 Offer Cascade Management

**Gap:** No automatic cascade when a caregiver declines an offer. The scoring engine ranks candidates, but the cascade (try next candidate) is manual.

**Manual step:** If the top-ranked caregiver declines:
1. View match results page
2. Note the second-ranked candidate
3. Create a new offer via the Visit Detail page
4. Repeat until accepted

**Phase 1 resolution:** Automated cascade workflow with configurable parallel/sequential strategy.

### 1.5 Score Result Staleness Check

**Gap:** Match results include `scored_at` timestamp but no automatic staleness warning in the UI.

**Manual step:** Re-run scoring before creating an offer if results are >15 minutes old. Employee availability may have changed.

**Phase 1 resolution:** Auto-refresh scoring before offer creation; show staleness warning in UI.

---

## 2. Data Not Available via API

### 2.1 Employee Availability Calendar

**Gap:** AlayaCare does not provide a dedicated "employee availability" endpoint. Availability is inferred from existing scheduled visits (absence of schedule conflict = available).

**Workaround:** The scoring engine checks schedule conflicts using `GET /scheduler/visits?date=YYYY-MM-DD` and filters employees with overlapping shifts. This misses non-visit unavailability (holidays, personal leave, blocked times).

**Impact:** Employees on personal leave may appear as available if their leave isn't recorded as a visit/blocked time in AlayaCare.

### 2.2 Employee Preferences

**Gap:** No API endpoint for caregiver preferences (preferred clients, maximum travel distance, shift time preferences).

**Workaround:** Not addressed in PoC. Acceptance likelihood dimension partially captures preferences (employees who consistently decline certain types of work will have lower acceptance scores).

**Phase 1 resolution:** Consider adding a preferences table in the local database, maintained by rostering staff.

### 2.3 Client Preferences

**Gap:** No API endpoint for client preferences (preferred caregivers, gender preferences, language requirements).

**Workaround:** Not addressed in PoC. Relationship history partially captures client-caregiver compatibility.

### 2.4 Real-Time Status Updates

**Gap:** No webhook or push notification from AlayaCare for visit status changes (clock-in, clock-out, cancellation).

**Workaround:** Visit status is only updated when the Visit Detail page is loaded (on-demand fetch). No polling or real-time updates.

**Phase 1 resolution:** Implement AlayaCare webhook integration (R1.5) for real-time event streaming.

### 2.5 Historical Scoring Decisions

**Gap:** Scoring results are not persisted. There is no audit trail of previous match decisions, which candidates were offered, or why a particular caregiver was selected.

**Workaround:** Manual screenshot or note-taking of match results before making assignment.

**Phase 1 resolution:** Persist scoring results and decisions in local database with audit trail (P1.19).

### 2.6 Bulk Employee Skills

**Gap:** Employee skills are fetched one-at-a-time (`/employees/employees/{id}/skills`). No bulk endpoint exists in AlayaCare API.

**Workaround:** 3-phase constraint split reduces calls — skills fetched only for schedule-eligible employees (~55 vs ~150). Server-side `status=active` filter further reduces pool. For production, add concurrency limit and server-side skill caching with TTL.

---

## 3. API Gaps & Limitations

### 3.1 Pagination

**Status:** Not implemented. All list endpoints return page 1 only.

**Risk:** Employee pools >100 per page may be truncated.

**Production fix:** Implement pagination loop in `alayaFetch` with automatic page iteration.

### 3.2 Rate Limiting

**Status:** Not tested (R1.6). Mock server has no rate limits.

**Risk:** Burst scoring requests to real AlayaCare sandbox may be throttled.

**Production fix:** Add `Retry-After` header handling, request queuing, and exponential backoff.

### 3.3 Concurrent Offer Conflict

**Status:** No optimistic locking or conflict detection.

**Risk:** Two users creating offers for the same vacant shift simultaneously. AlayaCare is source of truth but may not reject gracefully.

**Production fix:** Check visit assignment status before offer creation; handle 409 Conflict responses.

### 3.4 Visit Status Validation

**Status:** Scoring does not check visit status. Cancelled or completed visits can be scored.

**Production fix:** Add status check in match endpoint — reject scoring for cancelled/completed/approved visits.

---

## 4. Summary: What Works vs What Needs Manual Intervention

| Capability | Automated | Manual Step Required |
|-----------|-----------|---------------------|
| Candidate ranking (5 dimensions) | Yes | — |
| Hard constraint filtering | Yes | Ensure skills data is current |
| Weight preset selection | Yes | Choose appropriate preset |
| Custom weight configuration | Yes | — |
| Match confidence assessment | Yes | — |
| Data quality warnings | Yes | Act on warnings |
| Offer creation | Yes (API) | Select candidate manually |
| Offer cascade (decline → next) | No | Manual cascade |
| Availability check | Partial (schedule only) | Check for non-visit blocks |
| Score staleness | No | Re-score if >15 min old |
| Audit trail | No | Manual record-keeping |
| Real-time updates | No | Refresh page manually |
