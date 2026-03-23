# Chapter 1: Overview & Architecture

## Implementation Status

> **Reference only.** This chapter describes the full enterprise-grade architecture including RBAC, DynamoDB, Kinesis, and Lambda. The current implementation covers a subset: user lifecycle (Ch 2) and session management (Ch 3) running entirely on Supabase PostgreSQL + Next.js without RBAC, DynamoDB, or Lambda.
>
> **What's implemented in `requireAuthContext` + UoW:** Steps 1 (JWT), 3 (user status check), and 6 (execute handler). Steps 2 (RBAC), 4 (rate limiting), 5 (permission check), 7 (usage metering), and 8 (audit log) are future work. Note: `secureHandler` has been replaced by the `requireAuthContext()` + UoW (Unit of Work) pattern — see `src/server/require-auth-context.ts` and `src/server/uow/`.

## 1.1 System Boundaries

The user and usage management system sits between the authentication/RBAC layer and the business logic layer. It does not replace either — it observes, measures, and governs.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              Client                                     │
│                    (Next.js / React Native)                              │
└────────────────────────────┬────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         API Layer                                       │
│                                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────────┐  │
│  │    Auth       │  │    RBAC      │  │   User & Usage Management    │  │
│  │              │  │              │  │                              │  │
│  │ "Who are     │  │ "What can    │  │ "What have they done?        │  │
│  │  you?"       │  │  they do?"   │  │  How much have they used?    │  │
│  │              │  │              │  │  What is their status?       │  │
│  │ Cognito JWT  │  │ Role →       │  │  Are they within limits?"    │  │
│  │ verification │  │ Permission   │  │                              │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────────┬───────────────┘  │
│         │                 │                          │                  │
│         └────────┬────────┘                          │                  │
│                  │                                   │                  │
│         ┌────────▼────────────────────────────────────▼───────────────┐ │
│         │                    requireAuthContext() + UoW                          │ │
│         │                                                            │ │
│         │  1. Authenticate (JWT)                                     │ │
│         │  2. Resolve org + role (RBAC)                              │ │
│         │  3. Check user status (lifecycle)     ◄── NEW              │ │
│         │  4. Check rate limit (quotas)         ◄── NEW              │ │
│         │  5. Check permission (RBAC)                                │ │
│         │  6. Execute handler                                        │ │
│         │  7. Record usage event (metering)     ◄── NEW              │ │
│         │  8. Audit log (RBAC)                                       │ │
│         └────────────────────────────────────────────────────────────┘ │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## 1.2 Design Principles

| Principle | Rationale |
|-----------|-----------|
| **Write-path simplicity** | Usage events are appended, never updated. Hot-path writes go to a fast append-only store. |
| **Read-path flexibility** | Analytics queries run against pre-aggregated materialized tables, never raw events. |
| **Separation of concerns** | Metering (counting) is separate from limiting (enforcing). Metering is passive; limiting is active. |
| **Eventual consistency for analytics** | Dashboard numbers can lag by up to 5 minutes. Quota enforcement is near-real-time (< 1 second). |
| **Soft everything** | Users are soft-deleted, sessions are soft-revoked, data is soft-archived. Hard deletion only happens through explicit compliance workflows. |
| **Org-scoped by default** | Usage is tracked per-user but aggregated and billed per-org. An org owner sees everyone's usage. A member sees only their own. |

## 1.3 Subsystem Map

```
User & Usage Management System
│
├── User Lifecycle          (Ch. 2)
│   ├── Profile management
│   ├── Status machine (active → suspended → deleted)
│   ├── Account merge
│   └── Deprovisioning pipeline
│
├── Session Management      (Ch. 3)
│   ├── Device registry
│   ├── Concurrent session tracking
│   ├── Forced logout / session revocation
│   └── Session activity timeline
│
├── Usage Metering          (Ch. 4)
│   ├── Event ingestion (API calls, AI tokens, storage)
│   ├── Real-time counters (Redis / DynamoDB)
│   ├── Batch aggregation (hourly → daily → monthly)
│   └── Feature usage flags
│
├── Quotas & Rate Limiting  (Ch. 5)
│   ├── Plan definitions
│   ├── Sliding-window rate limiter
│   ├── Monthly quota enforcement
│   ├── Overage policies
│   └── Grace periods
│
├── Analytics & Reporting   (Ch. 6)
│   ├── Time-series dashboards
│   ├── Cohort analysis
│   ├── Retention metrics
│   ├── Engagement scoring
│   ├── Revenue/usage correlation
│   └── Export & scheduled reports
│
├── Admin Console           (Ch. 7)
│   ├── User search & detail
│   ├── Impersonation (support)
│   ├── Bulk operations
│   ├── Org management
│   ├── Feature flags
│   └── Incident response tools
│
├── Compliance              (Ch. 8)
│   ├── Data export (GDPR Art. 20)
│   ├── Right to erasure (GDPR Art. 17)
│   ├── Retention policies
│   ├── Consent management
│   └── Data processing records
│
└── Infrastructure          (Ch. 9)
    ├── DynamoDB event store
    ├── Kinesis ingestion stream
    ├── Lambda aggregators
    ├── PostgreSQL analytics tables
    └── CloudWatch alarms
```

## 1.4 Data Flow Architecture

### Hot Path (every API request)

```
Request arrives
    │
    ▼
requireAuthContext() + UoW
    │
    ├── 1. JWT verification (existing)
    ├── 2. Membership lookup (existing)
    ├── 3. User status check ──────────────────── PostgreSQL: users.status
    │      └── if suspended/deleted → 403
    ├── 4. Rate limit check ───────────────────── DynamoDB: rate_limit_counters
    │      └── if over limit → 429
    ├── 5. Permission check (existing)
    ├── 6. Execute handler
    ├── 7. Emit usage event (async, non-blocking)
    │      └── Kinesis putRecord ──────────────── Kinesis → Lambda → DynamoDB
    └── 8. Return response
```

### Cold Path (aggregation pipeline)

```
DynamoDB (raw events)                   PostgreSQL (analytics tables)
┌────────────────────┐                  ┌──────────────────────┐
│ usage_events       │                  │ usage_daily          │
│                    │   Lambda          │ usage_monthly        │
│ PK: orgId#userId   │   (scheduled)    │ usage_summary        │
│ SK: timestamp#type │ ──────────────►  │ user_engagement      │
│                    │   every 5 min    │ cohort_snapshots     │
│ api_calls: 1       │                  │                      │
│ tokens_in: 450     │                  └──────────────────────┘
│ tokens_out: 1200   │                           │
│ resource: projects │                           ▼
│ method: POST       │                  Admin Dashboard / Reports
└────────────────────┘
```

### Real-Time Counter Path (quota enforcement)

```
requireAuthContext() + UoW ──► DynamoDB Atomic Increment ──► Counter Value
                    (rate_limit_counters)              │
                                                       ├── Under limit → proceed
                                                       └── Over limit  → 429
```

## 1.5 New Permissions (extending RBAC)

The RBAC system gains new permission domains for user/usage management:

```typescript
// Additions to src/lib/rbac/permissions.ts

const PERMISSIONS = {
  // ... existing permissions from RBAC design ...

  // User Management (admin)
  "users:list":              "View all users in the org",
  "users:view_detail":       "View detailed user profile + activity",
  "users:suspend":           "Suspend a user account",
  "users:reactivate":        "Reactivate a suspended account",
  "users:delete":            "Soft-delete a user account",
  "users:impersonate":       "Act as another user (support)",

  // Usage & Analytics
  "usage:view_own":          "View own usage statistics",
  "usage:view_org":          "View org-wide usage statistics",
  "usage:export":            "Export usage data as CSV/JSON",

  // Analytics
  "analytics:view":          "View analytics dashboards",
  "analytics:cohorts":       "View cohort analysis",
  "analytics:export":        "Export analytics reports",

  // Quotas
  "quotas:view":             "View current quota limits and usage",
  "quotas:manage":           "Modify quota limits and plan",

  // Admin
  "admin:audit_log":         "View the audit log",
  "admin:feature_flags":     "Manage feature flags",
  "admin:system_health":     "View system health & metrics",
} as const;
```

## 1.6 Database Namespace

New tables are organized under clear prefixes:

| Prefix | Domain | Storage |
|--------|--------|---------|
| `user_*` | Lifecycle | PostgreSQL |
| `session_*` | Sessions | PostgreSQL (metadata) + DynamoDB (heartbeats) |
| `usage_*` | Metering | DynamoDB (raw) + PostgreSQL (aggregated) |
| `rate_limit_*` | Quotas | DynamoDB |
| `analytics_*` | Reporting | PostgreSQL (materialized) |
| `compliance_*` | Governance | PostgreSQL |
| `admin_*` | Operations | PostgreSQL |

## 1.7 How This Integrates with the Existing Codebase

### Files Modified

| File | Change |
|------|--------|
| `src/db/schema.ts` | Add user lifecycle fields, new tables |
| `src/server/require-auth-context.ts` | Auth resolution (replaces old `secureHandler`) |
| `src/server/uow/drizzle-uow.ts` | UoW transaction handling with tenant context |
| `src/lib/rbac/permissions.ts` | Add new permission domains |
| `src/services/user-service.ts` | Extend with lifecycle operations |
| `src/hooks/use-user.ts` | Extend with status, usage data |
| `app/api/orgs/[orgId]/` | New route groups for admin, analytics, usage |

### Files Added

| File | Purpose |
|------|---------|
| `src/services/session-service.ts` | Session CRUD and revocation |
| `src/services/usage-service.ts` | Usage event emission and queries |
| `src/services/quota-service.ts` | Rate limit and quota enforcement |
| `src/services/analytics-service.ts` | Aggregated analytics queries |
| `src/services/admin-service.ts` | Admin operations |
| `src/services/compliance-service.ts` | Data export, erasure |
| `src/lib/usage-emitter.ts` | Async event emission to Kinesis |
| `src/lib/rate-limiter.ts` | DynamoDB-backed sliding window |
| `src/hooks/use-usage.ts` | Client-side usage hooks |
| `src/hooks/use-analytics.ts` | Client-side analytics hooks |
| `src/hooks/use-sessions.ts` | Client-side session hooks |
| `src/hooks/use-admin.ts` | Client-side admin hooks |
