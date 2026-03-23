# PoC 1: Edge Cases & Limitations

Documented edge cases, API limitations, error scenarios, data quality issues, and conflicting update handling for the AlayaCare integration and scoring engine.

**Last updated:** 2026-03-11

---

## 1. Data Quality Issues

### 1.1 Missing Employee Coordinates

**Scenario:** Employees with `latitude: null` or `longitude: null`.

**Impact:** Proximity scorer returns `score: 0.5, confidence: "low"` (neutral fallback). These employees are not excluded by hard constraints — they can still be matched based on other dimensions.

**Frequency in test data:** 10/150 employees (6.7%).

**Warning generated:** `"X employees missing coordinates"` in `data_warnings`.

**Workaround:** Manual coordinate assignment in AlayaCare. For PoC, proximity weight can be reduced via the `efficiency` preset.

### 1.2 Missing Client Coordinates

**Scenario:** Client with `latitude: null` or `longitude: null`.

**Impact:** All proximity scores fallback to 0.5/low. Effectively disables geographic ranking.

**Warning generated:** `"Client missing coordinates — proximity unavailable"`.

**Workaround:** Reduce proximity weight or use `efficiency` preset which weights proximity at 0.1.

### 1.3 Employees with No Skills on File

**Scenario:** Employee has zero skill records in AlayaCare.

**Impact:** Fails hard constraint filter if visit has required skills. If visit has no required skills, skills scorer returns `score: 1.0, confidence: "low"`.

**Frequency in test data:** 10/150 employees (6.7%).

**Warning generated:** `"X employees have no skills on file"` (global), `"No skills on file"` (per-candidate).

### 1.4 Expired Skills

**Scenario:** Employee's only qualifications have `expired_date` in the past.

**Impact:** Hard constraint filter treats expired skills as not-held. Employee is excluded if expired skills were the only ones matching required qualifications.

**Frequency in test data:** 5/150 employees (3.3%) have only expired skills.

### 1.5 Visit with No Required Skills

**Scenario:** Visit has empty `required_skill_ids` array.

**Impact:** All employees pass the skills hard constraint check. Skills scorer returns `score: 1.0, confidence: "low"` for all candidates (no differentiation).

**Frequency in test data:** 5/55 visits (9%).

**Warning generated:** `"Visit has no required skills defined"`.

### 1.6 Visit with No Client Assigned

**Scenario:** Visit has `client_id: null`.

**Impact:** Client-dependent data (visit history, offers, client coordinates) unavailable. Relationship and proximity scorers fallback to neutral values. Acceptance scorer has no offer history to work from.

**Frequency in test data:** 5/55 visits (9%).

**Warning generated:** `"Visit has no client assigned"`.

---

## 2. API Limitations

### 2.1 Pagination

**Issue:** AlayaCare API returns paginated responses. Current implementation fetches page 1 only.

**Impact:** For large employee pools (>100 per page), some employees may be missed.

**Severity:** Medium — mock data stays within single page; real sandbox may not.

**Mitigation for production:** Implement pagination loop in `alayaFetch` or add `per_page` parameter.

### 2.2 N+1 Skill Queries (Partially Mitigated)

**Issue:** `computeMatch` fetches skills individually per employee (`/employees/employees/{id}/skills`). AlayaCare has no bulk skills endpoint.

**Impact:** For 150 employees, this could be 150 HTTP requests. Response time scales linearly with pool size.

**Mitigation (implemented):** 3-phase constraint split — schedule conflicts checked first (free), skills fetched only for schedule-eligible employees. Also `status=active` server-side filter reduces employee pool. Typical reduction: ~150 → ~55 API calls.

**Mitigation for production:** Add concurrency limit for large pools, implement server-side caching (short TTL).

### 2.3 No Webhook Support

**Issue:** AlayaCare webhooks are not implemented. No real-time event notification.

**Impact:** Clock-in/clock-out events are only visible via polling the visit detail endpoint. No push notifications for status changes.

**Status:** NOT STARTED (R1.5). Will be needed for Phase 1 real-time status monitoring.

### 2.4 Rate Limiting Unknown

**Issue:** AlayaCare rate limits not tested (R1.6).

**Impact:** Burst scoring requests could be throttled. No retry logic implemented.

**Mitigation:** Add `Retry-After` header handling in `alayaFetch`. For PoC, mock server has no rate limits.

### 2.5 No Bulk Operations

**Issue:** No AlayaCare bulk assignment endpoint discovered. Offers created one at a time.

**Impact:** Cascade workflow (try candidate 1 → if rejected → try candidate 2) requires sequential API calls with latency between each.

---

## 3. Error Scenarios

### 3.1 AlayaCare API Downtime

**Behaviour:** `alayaFetch` throws `"AlayaCare API error: {status} {statusText}"`.

**Handling:** All visit-related API routes map this to `ExternalServiceError` (HTTP 502) with error envelope and traceId.

**Client impact:** UI shows "Failed to load" message. Match results show error card.

### 3.2 Invalid Visit ID

**Behaviour:** Requesting match for non-existent visit ID.

**Handling:** AlayaCare returns 404 → mapped to 502 (external service error). Zod validates visit ID is positive integer (400 for invalid format).

### 3.3 Stale Data

**Scenario:** Employee availability changes between scoring and offer creation.

**Impact:** Offer creation may fail with 409 Conflict from AlayaCare if employee is no longer available.

**Handling:** Current implementation returns 502 for AlayaCare errors. Client should retry with next candidate (cascade pattern demonstrated in assignment workflow test).

### 3.4 JSON Parse Errors

**Behaviour:** Malformed request body sent to match or availability endpoint.

**Handling:** Caught explicitly with `try { await request.json() } catch { throw new ValidationError("Invalid JSON body") }`. Returns 400 with validation error.

---

## 4. Conflicting Update Handling

### 4.1 Race Condition: Simultaneous Offers

**Scenario:** Two users simultaneously offer the same shift to different employees.

**Current handling:** Both POST requests proceed. AlayaCare is the source of truth — it should reject the second offer if the shift is already assigned.

**Risk:** Low for PoC (single user). Medium for production.

**Mitigation for production:** Implement optimistic locking or check current assignment before creating offer.

### 4.2 Score Staleness

**Scenario:** Match scores calculated at time T, but employee data changes by time T+5 min.

**Current handling:** No staleness detection. Scores are point-in-time snapshots.

**Mitigation:** Add `scored_at` timestamp to results (already included). UI can show age of results. Consider re-scoring before offer creation in Phase 1.

### 4.3 Cancelled Visit Scoring

**Scenario:** User requests scoring for a cancelled visit.

**Current handling:** Scoring proceeds normally — hard constraints don't check visit status.

**Mitigation for production:** Add visit status check in match endpoint (reject scoring for cancelled/completed visits).

---

## 5. Mock Data Coverage Summary

| Edge Case | Fixture Count | Employee IDs | Visit IDs |
|-----------|---------------|--------------|-----------|
| Null employee coordinates | 10 | 141–150 | — |
| Inactive employees | 3 | 146–148 | — |
| On-leave employees | 2 | 149–150 | — |
| No skills on file | 10 | 131–140 | — |
| Expired skills only | 5 | 121–125 | — |
| Skills expiring soon | 5 | 126–130 | — |
| High acceptance rate | 5 | 101–105 | — |
| High decline rate | 5 | 106–110 | — |
| No offer history | 10 | 111–120 | — |
| Null client_id visits | 5 | — | 41–45 |
| Vacant visits | 5 | — | 46–50 |
| Overlapping shifts | 5 | 1–5 | 51–55 |
| No required skills | 5 | — | 36–40 |
| Completed with clock data | 10 | — | 1–10 |
| Clocked in (in progress) | 5 | — | 11–15 |

**Total:** 150 employees, 55 visits, ~800 offers, 10 skill types.
