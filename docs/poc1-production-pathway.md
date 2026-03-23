# PoC 1: Production Pathway

What changes when moving from PoC (mock/sandbox) to production AlayaCare integration. Covers authentication, URL configuration, rate limiting, caching, monitoring, and deployment.

**Last updated:** 2026-03-11

---

## 1. Authentication & Credentials

### Current State (PoC)
- Basic auth via `ALAYACARE_PUBLIC_KEY` / `ALAYACARE_PRIVATE_KEY` env vars
- Credentials point to mock server (`mock-alaya.vercel.app`) or sandbox
- `getRequiredEnv()` fails fast at startup if missing

### Production Changes
- **Obtain production API keys** from AlayaCare account manager
- **Separate credentials** per environment: development, staging, production
- **Key rotation:** Store keys in a secrets manager (AWS Secrets Manager or Supabase Vault). Rotate every 90 days.
- **IP allowlisting:** AlayaCare may require source IP registration. Configure NAT Gateway or static IP for production deployment.

### Configuration
```env
# Development (mock server)
ALAYACARE_API_URL=https://mock-alaya.vercel.app
ALAYACARE_PUBLIC_KEY=dev-public-key
ALAYACARE_PRIVATE_KEY=dev-private-key

# Production
ALAYACARE_API_URL=https://{tenant}.alayacare.com/api
ALAYACARE_PUBLIC_KEY=<from-secrets-manager>
ALAYACARE_PRIVATE_KEY=<from-secrets-manager>
```

---

## 2. URL Configuration

### Current State
- `ALAYACARE_API_URL` env var configures the base URL
- Mock server at `mock-alaya.vercel.app` mirrors AlayaCare endpoint structure
- `alayaFetch()` constructs full URLs from base + path

### Production Changes
- **Tenant-specific URL:** AlayaCare uses tenant subdomains (`{tenant}.alayacare.com`)
- **API version prefix:** Verify if production requires `/api/v1/` prefix (mock currently doesn't)
- **SSL/TLS:** Production uses HTTPS. No code changes needed (`fetch` handles TLS natively).

### Migration Steps
1. Set `ALAYACARE_API_URL` to production URL in deployment config
2. Verify all endpoint paths match production API documentation
3. Test each endpoint against production sandbox before going live
4. Update `next.config.ts` if AlayaCare API path structure differs

---

## 3. Rate Limiting Strategy

### Current State
- No rate limiting implemented (R1.6 NOT STARTED)
- Mock server has no rate limits
- Scoring engine makes 150+ requests per match (1 visit + 1 client + 150 employee skills + schedules + history + offers)

### Production Requirements

#### Recommended Implementation
```
Priority 1: Request queuing
  - Max concurrent requests to AlayaCare: 10
  - Queue overflow: reject with 503 Service Unavailable

Priority 2: Retry logic
  - Retry on 429 (Too Many Requests) with Retry-After header
  - Exponential backoff: 1s, 2s, 4s (max 3 retries)

Priority 3: Request batching
  - Deduplicate identical concurrent requests (e.g., same employee skills)
  - Batch time window: 50ms
```

#### Rate Limit Budget (Estimated)
| Operation | Requests | Frequency |
|-----------|----------|-----------|
| Single match scoring | ~155 | Per user action |
| Dashboard metrics | 4 | Per page load |
| Browse pages | 1–3 | Per page load |
| Offer creation | 1 | Per assignment |

**Key risk:** If AlayaCare rate limit is <200 requests/minute, a single match operation could exhaust the budget. Mitigation: implement skill caching (see §4).

---

## 4. Caching Strategy

### Current State
- `cache: "no-store"` on all `alayaFetch` calls (always-fresh)
- No server-side caching

### Production Cache Plan

| Data Type | TTL | Invalidation | Rationale |
|-----------|-----|-------------|-----------|
| Employee list | 5 min | On employee status change | Changes infrequently |
| Employee skills | 15 min | On skill update | Qualifications rarely change |
| Client details | 10 min | On client profile update | Address/coords stable |
| Skills catalog | 1 hour | Manual refresh | Reference data |
| Visit schedules | 30 sec | On scoring request | Availability changes frequently |
| Visit offers | No cache | — | Must be real-time |
| Match results | No cache | — | Point-in-time computation |

#### Implementation Options
1. **In-memory cache (recommended for Phase 1):** Node.js `Map` with TTL wrapper. Simple, no infrastructure. Clears on deploy.
2. **Redis/Upstash (Phase 2+):** Shared cache across serverless instances. Required if scaling to multiple workers.

#### Expected Impact
- Employee skills cache: **~150 fewer requests** per match (biggest win)
- Employee list cache: **~1 fewer request** per match
- Client detail cache: **~1 fewer request** per match
- **Net reduction:** ~155 requests → ~5 requests per match (97% reduction after warm-up)

---

## 5. Monitoring & Observability

### Current State
- Structured logging via `src/lib/logger.ts` (JSON in production, readable in dev)
- `traceId` threaded through auth context → handlers → error envelopes
- UoW lifecycle logged at debug level

### Production Monitoring Plan

#### Priority 1: AlayaCare API Health
- **Latency tracking:** Log response time for each `alayaFetch` call
- **Error rate monitoring:** Track 4xx/5xx rates from AlayaCare
- **Alert thresholds:**
  - API latency >2s: Warning
  - API latency >5s: Critical
  - Error rate >5% (5-min window): Critical
  - API unreachable: Immediate alert

#### Priority 2: Scoring Performance
- **Match computation time:** Log total time for `computeMatch()`
- **Pool sizes:** Log candidate_pool_size, eligible_pool_size per match
- **Cache hit rates:** Track cache effectiveness metrics

#### Priority 3: Business Metrics
- **Matches per day:** Track scoring volume
- **Offer acceptance rate:** Track offers created vs accepted
- **Mean rank of accepted candidate:** Validate scoring quality

#### Implementation
```
Phase 1: Log-based monitoring
  - Structured JSON logs → CloudWatch Logs / Supabase Logs
  - CloudWatch Metric Filters for latency and error rate alerts
  - Cost: Minimal (included in existing infrastructure)

Phase 2: APM integration
  - OpenTelemetry traces for distributed tracing
  - Grafana dashboards for real-time visibility
  - Custom metrics for scoring engine performance
```

---

## 6. Deployment Checklist

### Pre-Production
- [ ] Obtain production AlayaCare API credentials
- [ ] Verify all endpoint paths against production API docs
- [ ] Test each endpoint against production sandbox
- [ ] Configure rate limiting (concurrent request cap)
- [ ] Implement employee skills cache (15-min TTL)
- [ ] Set up API health monitoring and alerts
- [ ] Review security assessment (see `poc1-security-assessment.md`)
- [ ] Load test scoring with realistic employee pool size

### Go-Live
- [ ] Deploy with production `ALAYACARE_API_URL`
- [ ] Verify dashboard metrics load from real data
- [ ] Run 5 test scoring operations and verify results
- [ ] Confirm structured logs appear in monitoring dashboard
- [ ] Verify error handling for AlayaCare API errors (502 responses)

### Post-Launch (Week 1)
- [ ] Monitor API error rates and latency
- [ ] Review cache hit rates and adjust TTLs
- [ ] Validate scoring results against rostering staff expectations
- [ ] Document any production-specific edge cases or data quality issues

---

## 7. Environment Variable Summary

| Variable | PoC Value | Production Value |
|----------|-----------|-----------------|
| `ALAYACARE_API_URL` | `https://mock-alaya.vercel.app` | `https://{tenant}.alayacare.com/api` |
| `ALAYACARE_PUBLIC_KEY` | Mock key | Production API key (secrets manager) |
| `ALAYACARE_PRIVATE_KEY` | Mock key | Production API key (secrets manager) |
| `LOG_LEVEL` | `debug` | `info` |
| `NODE_ENV` | `development` | `production` |

---

## 8. Effort Estimate: PoC → Production

| Work Item | Effort | Priority |
|-----------|--------|----------|
| Credential setup + URL configuration | 2 hours | P0 |
| Endpoint verification against prod API | 4 hours | P0 |
| Request queuing + retry logic | 4 hours | P0 |
| Employee skills caching | 4 hours | P1 |
| API health monitoring + alerts | 4 hours | P1 |
| Pagination support (all list endpoints) | 4 hours | P1 |
| Load testing with realistic data | 4 hours | P1 |
| Visit status validation in match endpoint | 2 hours | P2 |
| Cache for employee list + client details | 2 hours | P2 |
| **Total** | **~30 hours** | **~1 sprint** |
