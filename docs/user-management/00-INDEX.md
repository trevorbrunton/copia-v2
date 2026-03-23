# User & Usage Management System Design

A complete enterprise-grade user lifecycle, session management, usage metering, analytics, and compliance system for myAgency. Designed to work in conjunction with the [RBAC system](../RBAC_SYSTEM_DESIGN.md) on the existing Cognito + Supabase PostgreSQL + Next.js stack.

---

## Implementation Status

Chapters 2 and 3 have been **partially implemented** for the current single-user tenant model (no RBAC/orgs prerequisite). The implementation is documented in the [implementation plan](/docs/plans/auth-user-management-implementation.md). See each chapter's "Implementation Status" section for details on what was built vs. what remains as future design.

| Chapter | Status |
|---------|--------|
| 01 Overview | Reference only — architecture diagram applies at a high level |
| 02 User Lifecycle | **Partially implemented** — core statuses, profile, self-service deletion |
| 03 Sessions | **Partially implemented** — device tracking, heartbeat, session revocation |
| 04 Usage Metering | Not implemented (future) |
| 05 Quotas | Not implemented (future) |
| 06 Analytics | Not implemented (future) |
| 07 Admin Console | Not implemented (future — requires RBAC) |
| 08 Compliance | Not implemented (future) |
| 09 Infrastructure | Not implemented (future) |
| 10 React Native | Not implemented (future) |

---

## Chapters

| # | Chapter | Description |
|---|---------|-------------|
| 01 | [Overview & Architecture](./01-OVERVIEW.md) | System boundaries, design principles, data flow, and how this system relates to auth/RBAC |
| 02 | [User Lifecycle Management](./02-USER-LIFECYCLE.md) | Profiles, statuses, suspension, soft-delete, reactivation, account merge |
| 03 | [Session & Device Management](./03-SESSIONS.md) | Concurrent session tracking, device fingerprinting, forced logout, session limits |
| 04 | [Usage Tracking & Metering](./04-USAGE-METERING.md) | Event collection, API call counting, AI token metering, storage tracking, feature usage |
| 05 | [Quotas & Rate Limiting](./05-QUOTAS.md) | Plan-based limits, sliding-window rate limiting, overage handling, grace periods |
| 06 | [Analytics & Reporting Engine](./06-ANALYTICS.md) | Time-series aggregation, dashboards, cohort analysis, retention, engagement scoring |
| 07 | [Admin Console & Operations](./07-ADMIN.md) | User search, impersonation, bulk operations, support tools, org management |
| 08 | [Compliance & Data Governance](./08-COMPLIANCE.md) | GDPR/CCPA, data export, right to erasure, retention policies, consent management |
| 09 | [AWS Infrastructure](./09-INFRASTRUCTURE.md) | DynamoDB for events, Kinesis pipeline, Lambda aggregators, CloudWatch, cost model |
| 10 | [React Native & TanStack Router](./10-REACT-NATIVE.md) | Mobile adaptation, offline usage tracking, device registration, mobile analytics |

---

## Prerequisites

The **full system** as designed assumes:

- The [RBAC system](../RBAC_SYSTEM_DESIGN.md) is implemented (organizations, memberships, roles)
- The existing Cognito + Supabase PostgreSQL + RLS foundation is in place
- The `requireAuthContext` + UoW pattern with org-scoped tenant context is active
- The `audit_log` table from the RBAC design exists

The **current partial implementation** (Chapters 2-3) works without RBAC, using the existing single-user tenant model with `app.current_tenant_id` RLS.

## Conventions Used

- **Database schemas** are shown in raw SQL with corresponding Drizzle ORM definitions
- **API routes** — the design uses `/api/orgs/[orgId]/...` (requires RBAC); the current implementation uses `/api/user/...` (single-user tenant)
- **Services** follow the existing pattern: `(tx: TransactionClient, ...) => Promise<T>`
- **Hooks** follow the existing pattern: TanStack Query with `apiFetch()`
- **Permissions** reference the RBAC permission system with new additions for admin/analytics domains (not yet implemented)
