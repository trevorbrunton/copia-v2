# PoC 1: Security & Audit Assessment

Security patterns, traceId coverage, compliance gaps, and audit logging needs for the AlayaCare integration and scoring engine.

**Last updated:** 2026-03-11

---

## 1. Authentication & Authorization

### 1.1 Current Auth Pattern

| Layer | Implementation | Status |
|-------|---------------|--------|
| **Client → DappaAi** | Supabase Auth (email/password, session cookies + Bearer tokens) | DONE |
| **DappaAi → AlayaCare** | HTTP Basic Auth (`ALAYACARE_PUBLIC_KEY`:`ALAYACARE_PRIVATE_KEY`) | DONE |
| **Route protection** | `requireAuthContext(req, traceId)` on all API routes | DONE |
| **Session management** | 15-min heartbeat, 30-day TTL, device fingerprinting | DONE |

### 1.2 Auth Enforcement

- **All AlayaCare proxy routes** require auth via `requireAuthContext()`.
- **Match endpoint** (`POST /api/v1/visits/[id]/match`) requires auth.
- **Availability endpoint** (`POST /api/v1/availability`) requires auth.
- **No anonymous access** to any API route.

### 1.3 Authorization Gaps

| Gap | Risk | Severity | Mitigation |
|-----|------|----------|------------|
| No role-based access control (RBAC) | All authenticated users can access all endpoints | Medium | Policy layer exists (`src/server/policies/`) as extension point; currently noop |
| No per-resource authorization | Any user can score any visit | Medium | Add visit ownership or org-based checks in Phase 1 |
| AlayaCare credentials shared | Single API key pair for all requests | Low (PoC) | Per-user or per-org credentials in production |

---

## 2. Request Traceability

### 2.1 traceId Coverage

Every API route generates a `traceId` (UUID v4) and threads it through:

| Component | traceId Present | Notes |
|-----------|----------------|-------|
| Route handler | Yes | `const traceId = crypto.randomUUID()` |
| Auth resolution | Yes | `requireAuthContext(req, traceId)` |
| Error responses | Yes | `handleAppError(err, traceId)` includes traceId in error envelope |
| UoW transactions | Yes | `AuthContext.traceId` → logged on commit/rollback |
| AlayaCare proxy calls | **No** | AlayaCare requests don't include DappaAi traceId |
| Client-side | **No** | `apiFetch()` doesn't send or receive traceId |

### 2.2 Traceability Gaps

| Gap | Impact | Recommendation |
|-----|--------|----------------|
| AlayaCare calls not traced | Cannot correlate DappaAi request with AlayaCare request | Add `X-Trace-Id` header to `alayaFetch` requests |
| Client → server trace gap | Cannot link UI action to API request | Return traceId in success responses; log in `apiFetch` |
| No request logging | Request metadata (method, path, duration) not logged | Add request logging middleware |

---

## 3. Data Security

### 3.1 Sensitive Data Handling

| Data Type | Storage | Transport | Risk |
|-----------|---------|-----------|------|
| AlayaCare API keys | Environment variables (`.env`) | HTTP Basic Auth header | Medium — keys in memory, not encrypted at rest |
| Supabase credentials | Environment variables | HTTPS | Low |
| Employee PII (names, coords) | AlayaCare (source of truth) | HTTPS to mock-alaya | Low (HTTPS) |
| Match results | In-memory only (not persisted) | HTTPS response | Low |
| Session tokens | Supabase cookies + localStorage | HTTPS | Low |

### 3.2 Data Exposure Risks

| Risk | Description | Severity | Mitigation |
|------|-------------|----------|------------|
| Match results expose employee names | `ScoredCandidate.employee_name` in API response | Low | Intended for authorized users; add RBAC for production |
| Employee coordinates in API response | Not directly exposed (used for scoring only) | Low | Coordinates stay server-side; only proximity score returned |
| Offer history inference | Acceptance score reveals offer patterns | Low | Aggregate score only; raw data not exposed |
| Console logging in dev | Structured logger may include PII in debug mode | Low | Logger sanitizes sensitive fields; `LOG_LEVEL=info` in production |

---

## 4. Input Validation

### 4.1 Validation Coverage

| Endpoint | Validation | Status |
|----------|-----------|--------|
| `POST /api/v1/visits/[id]/match` | Zod: weights sum to 1.0, preset enum, limit range, mutual exclusion | DONE |
| `POST /api/v1/availability` | Zod: client_id positive int, date YYYY-MM-DD, preset enum, limit range | DONE |
| `POST /api/v1/visits` | **None** — body passed through to AlayaCare | GAP |
| `POST /api/v1/visits/[id]/offers` | **None** — body passed through to AlayaCare | GAP |
| Visit ID param | Positive integer check | DONE |
| JSON body parsing | Explicit try/catch → ValidationError 400 | DONE |

### 4.2 Validation Gaps

| Gap | Risk | Recommendation |
|-----|------|----------------|
| Proxy routes pass body unvalidated | Injection risk if AlayaCare doesn't validate | Add Zod schemas for visit creation and offer creation request bodies |
| No output validation | AlayaCare could return unexpected shapes | Add response type validation or at least runtime type guards |
| URL parameter injection | SearchParams forwarded directly to AlayaCare | Allowlist valid query parameters instead of forwarding all |

---

## 5. Error Handling & Information Disclosure

### 5.1 Error Response Pattern

All errors follow a consistent envelope:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human-readable message",
    "details": [...],
    "traceId": "uuid"
  }
}
```

### 5.2 Error Classification

| Error Type | HTTP Status | Information Disclosed |
|------------|------------|----------------------|
| `ValidationError` | 400 | Field-level validation messages |
| `UnauthorizedError` | 401 | "Unauthorized" only |
| `ForbiddenError` | 403 | Optional reason code for account status |
| `NotFoundError` | 404 | Resource type only |
| `ExternalServiceError` | 502 | AlayaCare error message |
| Unhandled errors | 500 | "Internal server error" only |

### 5.3 Information Disclosure Risks

| Risk | Severity | Current Handling |
|------|----------|-----------------|
| AlayaCare error messages forwarded | Low | `ExternalServiceError` includes original message — could reveal AlayaCare internals |
| Stack traces | None | Not included in responses; logged server-side only |
| Database errors | None | Caught by `handleAppError`, returned as generic 500 |

---

## 6. Audit Logging

### 6.1 Current Logging

| Event | Logged | Location |
|-------|--------|----------|
| Auth resolution | Yes | `requireAuthContext` (debug level) |
| UoW start/commit/rollback | Yes | `drizzle-uow.ts` (debug level) |
| Unhandled errors | Yes | `handleAppError` (error level) |
| Successful API calls | **No** | — |
| AlayaCare API calls | **No** | — |
| Match scoring requests | **No** | — |
| Offer creation | **No** | — |

### 6.2 Audit Gaps for Production

| Gap | Compliance Impact | Recommendation |
|-----|------------------|----------------|
| No scoring audit log | Cannot explain why a caregiver was ranked #1 | Persist `MatchResult` to DB with traceId, user, timestamp |
| No assignment audit | Cannot prove who assigned which caregiver | Log offer creation with user, traceId, selected candidate rank |
| No access audit | Cannot prove who viewed which client/employee data | Add request logging middleware |
| No decision audit | Cannot explain escalation or cascade decisions | Required for Phase 1 LLM reasoning transparency |

### 6.3 Audit Architecture Recommendation

For Phase 1, implement an append-only `audit_events` table (per P4 decision):

```sql
CREATE TABLE audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trace_id UUID NOT NULL,
  user_id UUID NOT NULL,
  event_type TEXT NOT NULL,     -- 'match_scored', 'offer_created', 'escalated', etc.
  resource_type TEXT NOT NULL,  -- 'visit', 'employee', 'offer'
  resource_id TEXT NOT NULL,
  payload JSONB NOT NULL,       -- Full event details
  created_at TIMESTAMPTZ DEFAULT now()
);
```

---

## 7. Compliance Considerations

### 7.1 Privacy

| Consideration | Status | Notes |
|---------------|--------|-------|
| Employee PII access controls | GAP | All authenticated users see all employees |
| Client PII access controls | GAP | All authenticated users see all clients |
| Data minimisation | PARTIAL | Match results include names; could use IDs only |
| Right to erasure | N/A (PoC) | Data lives in AlayaCare (source of truth) |
| Cross-border data transfer | N/A (PoC) | Mock server is local |

### 7.2 Healthcare Compliance

| Consideration | Status | Notes |
|---------------|--------|-------|
| Qualification verification | DONE | Hard constraint filter checks skill validity and expiry |
| Assignment accountability | GAP | No audit trail of who assigned whom |
| Decision transparency | PARTIAL | `DimensionScore.reason` explains per-dimension; no overall narrative |
| Conflict of interest | N/A (PoC) | No conflict checking implemented |

---

## 8. Summary & Priority Recommendations

### Critical for Production (must fix before Phase 1)

1. **Add RBAC** — restrict endpoint access by role/org
2. **Implement audit logging** — persist scoring and assignment decisions
3. **Validate proxy route inputs** — add Zod schemas to visit creation and offer creation
4. **Add request logging** — log all API requests with traceId, user, method, path, duration

### Important (should fix before Phase 1)

5. **Thread traceId to AlayaCare** — add `X-Trace-Id` header
6. **Sanitise ExternalServiceError** — don't forward raw AlayaCare error messages
7. **Allowlist query parameters** — don't forward arbitrary params to AlayaCare
8. **Add response validation** — verify AlayaCare response shapes at runtime

### Nice to Have (address during Phase 1)

9. **Return traceId in success responses** — helps client-side debugging
10. **Implement rate limit handling** — retry with backoff on 429
11. **Add CSP headers** — for UI security hardening
12. **Session binding** — verify scoring request comes from same session that viewed the visit
