# WorkOS Evaluation: Feature-by-Feature Comparison

A systematic comparison of WorkOS against the custom-built auth, RBAC, and user/usage management system designed in the preceding documents. The evaluation measures each feature area against what we have designed, what WorkOS provides, what gaps remain, and what the migration cost/benefit looks like.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Evaluation Matrix](#2-evaluation-matrix)
3. [Authentication](#3-authentication)
4. [User Management & Lifecycle](#4-user-management--lifecycle)
5. [Organizations & Multi-Tenancy](#5-organizations--multi-tenancy)
6. [RBAC & Permissions](#6-rbac--permissions)
7. [Invitations & Onboarding](#7-invitations--onboarding)
8. [Session Management](#8-session-management)
9. [Audit Logging](#9-audit-logging)
10. [Enterprise SSO (SAML/OIDC)](#10-enterprise-sso-samloidc)
11. [Directory Sync (SCIM)](#11-directory-sync-scim)
12. [Bot & Fraud Protection](#12-bot--fraud-protection)
13. [Encryption & Key Management](#13-encryption--key-management)
14. [Usage Metering & Quotas](#14-usage-metering--quotas)
15. [Analytics & Reporting](#15-analytics--reporting)
16. [Compliance & Data Governance](#16-compliance--data-governance)
17. [Admin Console & Operations](#17-admin-console--operations)
18. [Mobile / React Native Support](#18-mobile--react-native-support)
19. [Infrastructure & Operational Burden](#19-infrastructure--operational-burden)
20. [Cost Analysis](#20-cost-analysis)
21. [Migration Assessment](#21-migration-assessment)
22. [Recommendation](#22-recommendation)

---

## 1. Executive Summary

WorkOS is a strong fit for **authentication, SSO, directory sync, and RBAC** — the identity and access layer. It is not a fit for **usage metering, analytics, quotas, or compliance workflows** — the operational intelligence layer.

The optimal strategy is a **hybrid architecture**: adopt WorkOS for identity/auth/authorization (replacing Cognito + custom RBAC), and keep the custom-built systems for usage tracking, analytics, quotas, and compliance.

```
┌──────────────────────────────────────────────────────────────┐
│                     REPLACE WITH WORKOS                       │
│                                                              │
│  ✓ Authentication (AuthKit replaces Cognito + custom auth)   │
│  ✓ Organizations & memberships                               │
│  ✓ RBAC roles & permissions                                  │
│  ✓ Invitations                                               │
│  ✓ Session tokens (JWT with role/permission claims)          │
│  ✓ Audit logging (basic event capture)                       │
│  ✓ Enterprise SSO (SAML/OIDC — new capability)              │
│  ✓ Directory Sync (SCIM — new capability)                   │
│  ✓ Bot/fraud protection (Radar — new capability)            │
│                                                              │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│                     KEEP CUSTOM-BUILT                         │
│                                                              │
│  ✗ Usage metering (API calls, AI tokens, storage)            │
│  ✗ Quota enforcement & rate limiting                         │
│  ✗ Analytics & reporting (engagement, cohorts, dashboards)   │
│  ✗ User status machine (suspended/soft_deleted/purged)       │
│  ✗ Compliance workflows (data export, erasure pipeline)      │
│  ✗ Device-level session tracking & heartbeats                │
│  ✗ Feature flags                                             │
│  ✗ Admin impersonation                                       │
│  ✗ Scheduled reports                                         │
│  ✗ Consent management                                        │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## 2. Evaluation Matrix

| Feature Area | Our Design | WorkOS | Verdict |
|-------------|-----------|--------|---------|
| **Authentication** | Cognito (email/password, MFA) | AuthKit (email/password, magic link, social, MFA, passkeys) | **WorkOS wins** — more auth methods, hosted UI, 1M free MAU |
| **Enterprise SSO** | Not designed | SAML + OIDC, 20+ IdPs, Admin Portal | **WorkOS wins** — we'd have to build from scratch |
| **Directory Sync** | Not designed | SCIM, all major directories, webhooks | **WorkOS wins** — we'd have to build from scratch |
| **Organizations** | Custom (Aurora + RLS) | Built-in multi-tenancy | **Comparable** — both work; WorkOS is less code to maintain |
| **RBAC** | Custom (code-defined, flat) | Dashboard/API-defined, multiple roles per user | **WorkOS wins** — more flexible, supports org-level custom roles |
| **Invitations** | Custom (token-based, email) | Built-in with email delivery | **Comparable** — WorkOS handles email; ours is more customizable |
| **Sessions** | Custom (Aurora + Cognito tokens) | JWT with claims, configurable lifetime/inactivity | **WorkOS slight edge** — role/permissions baked into JWT claims |
| **Audit Logging** | Custom (Aurora, rich queries, admin UI) | Event ingestion + SIEM export | **Our design wins** — WorkOS requires you to emit events; ours auto-captures |
| **User Lifecycle** | Full state machine with purge pipeline | Basic (active users, no status machine) | **Our design wins** — WorkOS has no suspend/soft-delete/purge |
| **Device Tracking** | Custom (device registry, fingerprinting) | Radar fingerprinting (auth events only) | **Our design wins** — persistent device registry across sessions |
| **Usage Metering** | Full pipeline (Kinesis → DynamoDB → Aurora) | Not offered | **Our design wins** — WorkOS does not meter usage |
| **Quotas & Limits** | Plan-based with DynamoDB counters | Not offered | **Our design wins** — WorkOS does not enforce quotas |
| **Analytics** | Engagement scoring, cohorts, dashboards | Not offered | **Our design wins** — WorkOS has no analytics |
| **Compliance** | GDPR export, erasure pipeline, consents | Not offered (beyond audit log storage) | **Our design wins** — WorkOS does not handle data subject rights |
| **Bot Protection** | Not designed | Radar (fingerprinting, impossible travel) | **WorkOS wins** — we'd have to build or buy separately |
| **Encryption/Vault** | Not designed | Vault with EKM/BYOK | **WorkOS wins** — useful for customer-managed keys at enterprise tier |
| **Admin Console** | Full (search, impersonation, bulk ops) | WorkOS Dashboard + Admin Portal | **Our design wins** — our admin tools are app-specific |
| **Feature Flags** | Custom (plan/org/user/percentage rules) | Not offered | **Our design wins** |
| **Mobile Support** | Full React Native chapter | SDK-agnostic (REST API) | **Comparable** — WorkOS has no mobile SDK but REST API works |

---

## 3. Authentication

### What WorkOS Provides

| Feature | WorkOS (AuthKit) | Our Design (Cognito) |
|---------|-----------------|---------------------|
| Email + password | Yes | Yes |
| Magic link (passwordless) | Yes | No |
| Social login (Google, Microsoft, GitHub, Apple) | Yes, pre-built | Possible but requires Cognito federation setup |
| Passkeys / WebAuthn | Yes | No |
| MFA (TOTP, SMS) | Yes | Yes (Cognito) |
| Hosted login UI | Yes (AuthKit, customizable with Radix) | No (we built our own) |
| Custom login UI | Yes (headless mode) | Yes (our current approach) |
| Email verification | Yes | Yes (Cognito) |
| Password policy | Configurable | Configurable (Cognito) |
| Branding / theming | Yes (AuthKit customization) | Manual (our CSS) |

### Assessment

WorkOS AuthKit is strictly superior to our Cognito-based auth for feature breadth. The free tier of 1M MAU eliminates the Cognito per-user cost. AuthKit's hosted UI with Radix components would replace our hand-built sign-in/sign-up/verify pages, reducing code to maintain.

**Migration impact**: Replace `src/auth/` module entirely. The `AuthProvider`, `AuthContext`, and `useAuth()` hook interfaces stay the same — the implementation changes from Amplify SDK calls to WorkOS AuthKit SDK calls.

### What We Lose

- Direct Cognito control (custom Lambda triggers, advanced password policies)
- Cognito's built-in device tracking (we use custom device tracking anyway)

### What We Gain

- Magic links, passkeys, social login — zero custom code
- Hosted login UI (less code to maintain and fewer auth-related bugs)
- No Cognito User Pool infrastructure to manage

---

## 4. User Management & Lifecycle

### What WorkOS Provides

| Feature | WorkOS | Our Design |
|---------|--------|-----------|
| User CRUD | Yes (API + Dashboard) | Yes (Aurora + API) |
| User profiles (name, email, avatar) | Yes | Yes (extended with timezone, locale, metadata) |
| User statuses | Basic (no formal state machine) | Full state machine: pending → active → suspended → soft_deleted → purged |
| Suspension | Not built-in | Yes, with reason tracking and admin audit |
| Soft delete with retention window | Not built-in | Yes, 30-day window with auto-purge |
| Login tracking (last login, count) | Partial (via events) | Yes, first-class fields on user record |
| Status change history | No | Yes, full history table with audit trail |
| User metadata (custom fields) | Yes (limited) | Yes (JSONB, unlimited) |

### Assessment

WorkOS treats users as identity records — who they are and how they authenticate. Our design extends this into lifecycle management — what happens when they're suspended, when they leave, how long their data is retained.

**Verdict**: WorkOS covers the identity layer. The lifecycle layer (status machine, suspension, soft-delete, purge pipeline) must remain custom. These concerns can coexist: WorkOS manages the identity, our Aurora tables track the lifecycle state.

### Hybrid Approach

```
WorkOS                              Aurora (our tables)
┌──────────────────────┐            ┌──────────────────────┐
│ User identity        │            │ User lifecycle       │
│                      │            │                      │
│ • workos_user_id     │──────────►│ • workos_user_id (FK)│
│ • email              │            │ • status             │
│ • name               │            │ • status_reason      │
│ • auth_method        │            │ • deleted_at         │
│ • mfa_enabled        │            │ • purge_after        │
│ • last_sign_in       │            │ • last_login_at      │
│                      │            │ • login_count        │
│ Managed by WorkOS    │            │ • metadata           │
└──────────────────────┘            │                      │
                                    │ Managed by us        │
                                    └──────────────────────┘
```

---

## 5. Organizations & Multi-Tenancy

### What WorkOS Provides

| Feature | WorkOS | Our Design |
|---------|--------|-----------|
| Organization CRUD | Yes | Yes |
| Organization memberships | Yes (first-class, with roles) | Yes (org_memberships table) |
| Multiple org membership | Yes | Yes |
| Organization settings | Basic | Custom (plan, slug, metadata) |
| Organization-scoped data | No (application responsibility) | Yes (RLS with app.tenant_id) |
| Admin Portal (self-service SSO/directory setup) | Yes | No (not applicable) |

### Assessment

WorkOS organizations map directly to our `organizations` table. The membership model is almost identical. The key difference: WorkOS handles the membership + role assignment, but data isolation (RLS) remains our responsibility.

**What changes**: Our `org_memberships` table becomes unnecessary — WorkOS is the source of truth for "who belongs to which org with what role." Our `organizations` table stays because it holds app-specific fields (plan, slug, billing).

**What stays the same**: RLS policies, `withTenantContext()`, and `secureHandler()` still scope data by org. The `orgId` now comes from WorkOS's JWT claims instead of our database lookup.

---

## 6. RBAC & Permissions

### What WorkOS Provides

| Feature | WorkOS | Our Design |
|---------|--------|-----------|
| Role definitions | Dashboard + API | Code-defined (version-controlled) |
| Permission definitions | Dashboard + API | Code-defined |
| Role → permission mapping | Dashboard + API | Code-defined (ROLE_PERMISSIONS map) |
| Multiple roles per user | Yes | No (single role per membership) |
| Organization-scoped custom roles | Yes (org-level overrides) | No |
| Permission in JWT claims | Yes (baked into access token) | No (looked up per request from DB) |
| Role hierarchy | Configurable | Implicit (owner > admin > member > viewer) |
| `_own` resource-level checks | No | Yes (`hasPermissionForResource`) |

### Assessment

WorkOS RBAC is more flexible (multiple roles, org-level customization, dashboard management). Our design is more deterministic (code-defined, version-controlled, no drift between environments).

**Key difference**: WorkOS puts permissions in the JWT. This means permission checks are a local JWT decode — no database query. But role changes don't take effect until the token is refreshed (up to the access token lifetime). Our design resolves role from the database on every request, so role changes are instant.

**What we keep**: The `_own` pattern (`projects:update_own`) is application-specific logic that WorkOS doesn't model. The `hasPermissionForResource()` check stays in `secureHandler`. WorkOS provides the `can(permission)` check; we add the ownership layer on top.

### Hybrid Approach

```typescript
// Updated secureHandler with WorkOS:

// 1. Verify WorkOS access token (replaces Cognito JWT verification)
const session = await workos.userManagement.loadSealedSession({ ... });
const authResult = await session.authenticate();

// 2. Extract org, role, and permissions from JWT claims (no DB lookup needed)
const { orgId, role, permissions } = authResult;

// 3. Check user lifecycle status (still in our DB)
const user = await getUserByWorkOSId(tx, authResult.userId);
if (user.status !== "active") return forbidden();

// 4. Route-level permission check (from JWT claims)
if (requiredPermission && !permissions.includes(requiredPermission)) {
  return forbidden();
}

// 5. Resource-level ownership check (still custom)
const canForResource = (unrestricted, own, creatorId) => {
  if (permissions.includes(unrestricted)) return true;
  if (permissions.includes(own) && creatorId === user.id) return true;
  return false;
};
```

---

## 7. Invitations & Onboarding

### What WorkOS Provides

| Feature | WorkOS | Our Design |
|---------|--------|-----------|
| Email invitations | Yes (WorkOS sends the email) | Yes (SES, custom email) |
| Invitation tokens | Yes (managed by WorkOS) | Yes (custom tokens, 7-day expiry) |
| New user + org join in one step | Yes | Yes |
| Existing user + org join | Yes (consent-based) | Yes |
| Invitation revocation | Yes | Yes |
| Bulk invitations | Not documented | Not documented (single API) |
| Custom email templates | Yes (partial) | Yes (full SES control) |
| Invitation rate limiting | Not documented | Yes (20/hour per org) |

### Assessment

Comparable. WorkOS handles the email delivery and token lifecycle. Our design gives more control over email templates and rate limiting. For most use cases, WorkOS's built-in invitation flow is sufficient and removes code.

---

## 8. Session Management

### What WorkOS Provides

| Feature | WorkOS | Our Design |
|---------|--------|-----------|
| JWT access tokens | Yes | Yes (Cognito) |
| Refresh tokens | Yes | Yes (Cognito) |
| Configurable session lifetime | Yes (dashboard) | Yes (Cognito settings) |
| Inactivity timeout | Yes | No (token expiry only) |
| Session revocation | Yes (via logout endpoint) | Yes (per-session, per-user, per-device) |
| Org switching without re-auth | Yes (refresh with org_id) | No (requires switching context manually) |
| Concurrent session tracking | Not offered | Yes (user_sessions table) |
| Device registry | Not offered | Yes (user_devices table with fingerprinting) |
| Session heartbeats | Not offered | Yes (5-min heartbeat updates lastActiveAt) |
| Per-plan session limits | Not offered | Yes (evict oldest when limit exceeded) |
| "Active sessions" user view | Not offered | Yes (list all devices, revoke individually) |

### Assessment

WorkOS handles the token lifecycle (issuance, refresh, revocation) well. But our design goes much deeper with device-level tracking, concurrent session limits, heartbeats, and a user-facing "manage your devices" UI.

**Verdict**: Use WorkOS for token management. Keep the `user_devices` and `user_sessions` tables for device-level tracking and session visibility. The WorkOS session ID (`sid` claim) becomes the link between the two systems.

---

## 9. Audit Logging

### What WorkOS Provides

| Feature | WorkOS | Our Design |
|---------|--------|-----------|
| Event ingestion API | Yes (you emit events) | Yes (auto-captured in secureHandler) |
| Pre-defined event schemas | Yes (configure in dashboard) | No (freeform action strings) |
| Event storage | Yes | Yes (Aurora audit_log table) |
| SIEM export | Yes ($125/mo per connection) | No (manual export) |
| Dashboard viewer | Yes (WorkOS Dashboard) | Yes (custom admin UI with filters) |
| Event query API | Yes | Yes (rich filtering by user, action, date, IP) |
| Auto-capture on mutations | No (developer must emit) | Yes (built into secureHandler) |
| Impersonation tracking | No | Yes (impersonated_by field) |
| Custom metadata per event | Yes (targets, metadata) | Yes (JSONB metadata field) |
| Retention | Configurable (paid) | 2 years (self-managed) |

### Assessment

WorkOS audit logs are designed for enterprise compliance — they shine at SIEM integration and providing an out-of-the-box dashboard to enterprise customers via the Admin Portal. However, they require you to manually emit every event via API calls. Our design auto-captures audit events within `secureHandler`, meaning no event is ever missed.

**Verdict**: Use both. Route the same events to WorkOS (for enterprise customers who want SIEM export and the Admin Portal view) AND to our Aurora `audit_log` table (for our internal admin console and analytics). The cost is negligible — one extra API call per mutation.

---

## 10. Enterprise SSO (SAML/OIDC)

### What WorkOS Provides

WorkOS is the market leader in SSO integration:

- 20+ pre-built IdP integrations (Okta, Azure AD, OneLogin, Google Workspace, ADFS, PingFederate, etc.)
- Admin Portal: self-service UI for customer IT admins to configure SSO — no developer involvement
- SAML and OIDC support
- JIT (Just-In-Time) provisioning
- IdP-initiated and SP-initiated flows

### Our Design

Not designed. The RBAC system assumes Cognito email/password auth. Enterprise SSO would require significant custom work with Cognito's federation features, which are notoriously complex.

### Assessment

**WorkOS is the clear winner** here. This is their core product and where they provide the most value. Building SAML/OIDC federation on Cognito is painful, error-prone, and a maintenance burden. WorkOS abstracts all IdP-specific quirks.

**Pricing**: $125 per SSO connection. For an agency app where each enterprise client is one connection, this scales linearly. At 20 enterprise clients, that's $2,500/mo — offset by the revenue those clients generate.

---

## 11. Directory Sync (SCIM)

### What WorkOS Provides

- Automated user provisioning/deprovisioning via SCIM
- Supported directories: Okta, Azure AD, Google Workspace, OneLogin, JumpCloud, BambooHR, Workday, Rippling
- Group sync (directory groups → org roles)
- Real-time webhooks for directory changes
- Admin Portal for self-service setup

### Our Design

Not designed. Our invitation flow is manual.

### Assessment

**WorkOS wins by default** — we have nothing to compare against. Directory Sync becomes important when enterprise customers want automated provisioning from their corporate directory. Building SCIM compliance is a multi-month effort.

**Pricing**: Same as SSO ($125/connection with volume discounts).

---

## 12. Bot & Fraud Protection

### What WorkOS Provides (Radar)

- 20+ device fingerprinting signals
- Bot detection (headless browser, automation frameworks)
- Credential stuffing detection (breached password databases)
- Brute force protection
- Impossible travel detection
- Unknown device detection
- Configurable actions: Allow / Challenge / Block
- First 1,000 checks/month free, then $100/50K checks

### Our Design

Not designed. We have basic rate limiting (Chapter 5) but no fraud detection or device fingerprinting at the auth layer.

### Assessment

**WorkOS wins** — Radar is a purpose-built security product. Our rate limiter prevents abuse at the API level but doesn't detect sophisticated threats like credential stuffing or impossible travel. Radar integrates directly with AuthKit, providing protection at the authentication boundary.

---

## 13. Encryption & Key Management

### What WorkOS Provides (Vault)

- Envelope encryption for secrets, tokens, certificates
- BYOK (Bring Your Own Key) with AWS KMS, GCP KMS, Azure Key Vault, HashiCorp Vault
- Per-customer key isolation (important for enterprise multi-tenancy)
- Key rotation

### Our Design

Not designed. Aurora provides encryption at rest (AWS-managed KMS). No per-customer key isolation.

### Assessment

**WorkOS wins for enterprise** — customer-managed encryption keys (BYOK) is a common enterprise procurement requirement. Building this in-house requires significant cryptographic expertise. For agency-tier customers who don't need BYOK, Aurora's default encryption is sufficient.

---

## 14. Usage Metering & Quotas

### What WorkOS Provides

Nothing. WorkOS does not track application usage, enforce quotas, or provide rate limiting for your application's business logic.

### Our Design

- Full metering pipeline: Kinesis → DynamoDB → Aurora aggregations
- Five metering categories: API calls, AI tokens, storage, compute, feature usage
- DynamoDB sliding-window rate limiter
- Monthly quota enforcement with plan-based limits
- Overage policies with grace periods
- Warning thresholds with email notifications
- Cost estimation per org

### Assessment

**Our design wins by default** — this is entirely out of scope for WorkOS. Usage metering is application-specific and must remain custom-built. No identity platform provides this.

---

## 15. Analytics & Reporting

### What WorkOS Provides

Nothing application-level. WorkOS Dashboard shows auth events (sign-ups, sign-ins) but no engagement analytics, cohort analysis, or usage dashboards.

### Our Design

- Engagement scoring (7 weighted signals → 0-100)
- User segmentation (power / active / casual / at_risk / inactive)
- Cohort retention analysis
- DAU/MAU/WAU/stickiness metrics
- Feature adoption tracking
- Scheduled reports with email delivery
- CSV/JSON export

### Assessment

**Our design wins** — analytics and reporting are entirely application-specific. WorkOS provides no analytical tooling for your application's data.

---

## 16. Compliance & Data Governance

### What WorkOS Provides

| Feature | WorkOS | Our Design |
|---------|--------|-----------|
| Audit log storage | Yes | Yes |
| SIEM export | Yes ($125/mo) | No |
| Data export (GDPR Art. 20) | Not offered | Yes (full pipeline) |
| Right to erasure (GDPR Art. 17) | Not offered | Yes (multi-system purge) |
| Consent management | Not offered | Yes (per-type opt-in/out) |
| Data retention policies | Audit log retention (paid) | Full (per-table, automated) |
| Processing records (GDPR Art. 30) | Not offered | Yes (machine-readable) |
| User data portability | Not offered | Yes (JSON/CSV export) |

### Assessment

**Our design wins** — WorkOS provides no compliance workflows beyond audit log storage. Data subject rights (export, erasure, consent) are application-specific responsibilities that no identity vendor handles. The SIEM export is useful for enterprise customers, but the compliance heavy lifting (data mapping, erasure pipeline, consent tracking) must remain custom.

---

## 17. Admin Console & Operations

### What WorkOS Provides

| Feature | WorkOS | Our Design |
|---------|--------|-----------|
| User search | Yes (Dashboard) | Yes (API + custom UI) |
| User CRUD | Yes (Dashboard + API) | Yes |
| Org management | Yes (Dashboard + API) | Yes |
| Role assignment | Yes (Dashboard + API) | Yes |
| Admin Portal (for customer IT admins) | Yes (SSO/directory self-service) | No |
| Impersonation | Not offered | Yes (time-limited, read-only, audited) |
| Bulk operations | Not documented | Yes (suspend/reactivate/role change, max 50) |
| Feature flags | Not offered | Yes (plan/org/user/percentage targeting) |
| Audit log viewer | Yes (Dashboard) | Yes (custom UI with rich filtering) |
| User engagement detail | No | Yes (activity timeline, engagement score) |

### Assessment

WorkOS provides a solid baseline admin experience (Dashboard for your team, Admin Portal for customer IT admins). Our design provides deeper application-specific admin tooling (impersonation, bulk ops, engagement data, feature flags). Both are needed in a mature product.

---

## 18. Mobile / React Native Support

### What WorkOS Provides

- REST API (SDK-agnostic, works from any HTTP client)
- No dedicated React Native SDK
- AuthKit is web-focused (redirect-based flow)
- Headless mode available for custom native UI
- JWT access tokens work with Bearer auth (same as our current setup)

### Our Design

- Full React Native chapter with expo-secure-store, device fingerprinting, heartbeats
- TanStack Router guards for auth/org/permission
- AppState-aware token refresh
- Client-side usage event buffering
- Native quota/status UI components

### Assessment

**Comparable** — WorkOS's REST API works from React Native, but the auth flow requires more manual work (no mobile SDK with built-in token management). Our existing mobile architecture (Bearer tokens, secure storage, foreground refresh) maps cleanly onto WorkOS's token model. The mobile-specific UX code (quota warnings, session management, consent screens) is unchanged regardless of identity provider.

---

## 19. Infrastructure & Operational Burden

### With Our Current Design (Cognito + Custom Everything)

| Component | Managed by us | Operational burden |
|-----------|---------------|-------------------|
| Cognito User Pool | AWS-managed | Low (but limited customization) |
| Aurora (auth tables) | AWS-managed (Serverless v2) | Medium (schema migrations, RLS policies) |
| DynamoDB (3 tables) | AWS-managed | Low (on-demand, TTL handles cleanup) |
| Kinesis | AWS-managed | Low |
| Lambda (6 functions) | AWS-managed | Medium (deployment, monitoring, debugging) |
| S3 (2 buckets) | AWS-managed | Low |
| SES | AWS-managed | Low |
| Custom auth code | Us | High (security-critical, must be perfect) |
| Custom RBAC code | Us | Medium (permission logic, role management) |
| Custom session code | Us | Medium (device tracking, heartbeats) |
| Custom compliance code | Us | High (GDPR correctness, multi-system purge) |

### With WorkOS (Hybrid)

| Component | Managed by | Operational burden |
|-----------|-----------|-------------------|
| Authentication | WorkOS | None (SaaS) |
| SSO/OIDC/SAML | WorkOS | None (SaaS) |
| Directory Sync | WorkOS | None (SaaS) |
| Organizations/Memberships | WorkOS | None (SaaS) |
| RBAC (roles/permissions) | WorkOS | None (SaaS) |
| Sessions (token lifecycle) | WorkOS | None (SaaS) |
| Bot protection | WorkOS | None (SaaS) |
| Aurora (lifecycle + analytics) | AWS-managed | Medium (reduced surface — no auth tables) |
| DynamoDB (3 tables) | AWS-managed | Low (unchanged) |
| Kinesis + Lambda | AWS-managed | Low-medium (unchanged) |
| Custom lifecycle code | Us | Medium (status machine, purge) |
| Custom usage/quota code | Us | Medium (unchanged) |
| Custom analytics code | Us | Medium (unchanged) |
| Custom compliance code | Us | High (unchanged) |

**Net reduction**: ~30% less custom code to maintain. The highest-risk code (authentication, token management, session security) moves to WorkOS.

---

## 20. Cost Analysis

### Current Design (Cognito + Custom)

| Component | Cost at 1K MAU | Cost at 10K MAU | Cost at 50K MAU |
|-----------|---------------|-----------------|-----------------|
| Cognito | Free (< 50K) | Free (< 50K) | $275/mo |
| Aurora Serverless v2 | ~$50/mo | ~$60/mo | ~$80/mo |
| DynamoDB | ~$5/mo | ~$20/mo | ~$60/mo |
| Kinesis + Lambda | ~$5/mo | ~$15/mo | ~$40/mo |
| S3 + SES | ~$3/mo | ~$5/mo | ~$10/mo |
| Developer time (auth/RBAC maintenance) | ~$2,000/mo | ~$2,000/mo | ~$2,000/mo |
| **Total** | **~$2,063/mo** | **~$2,100/mo** | **~$2,465/mo** |

### WorkOS Hybrid

| Component | Cost at 1K MAU | Cost at 10K MAU | Cost at 50K MAU |
|-----------|---------------|-----------------|-----------------|
| WorkOS AuthKit | Free (< 1M) | Free (< 1M) | Free (< 1M) |
| WorkOS SSO (10 connections) | $1,250/mo | $1,250/mo | $1,250/mo |
| WorkOS Directory Sync (10 connections) | $1,250/mo | $1,250/mo | $1,250/mo |
| WorkOS Radar | Free (< 1K) | ~$20/mo | ~$100/mo |
| WorkOS Audit Logs (SIEM) | $125/mo | $125/mo | $125/mo |
| Aurora Serverless v2 (reduced) | ~$40/mo | ~$50/mo | ~$65/mo |
| DynamoDB + Kinesis + Lambda | ~$10/mo | ~$35/mo | ~$100/mo |
| Developer time (reduced) | ~$1,200/mo | ~$1,200/mo | ~$1,200/mo |
| **Total** | **~$3,875/mo** | **~$3,930/mo** | **~$4,090/mo** |

### Without Enterprise Features (SSO/Directory Sync)

If you don't need enterprise SSO and Directory Sync yet:

| Component | Cost at 1K MAU | Cost at 10K MAU | Cost at 50K MAU |
|-----------|---------------|-----------------|-----------------|
| WorkOS AuthKit | Free | Free | Free |
| WorkOS Radar | Free | ~$20/mo | ~$100/mo |
| Aurora + DynamoDB + Lambda | ~$50/mo | ~$85/mo | ~$165/mo |
| Developer time (reduced) | ~$1,200/mo | ~$1,200/mo | ~$1,200/mo |
| **Total** | **~$1,250/mo** | **~$1,305/mo** | **~$1,465/mo** |

**Key insight**: WorkOS is cheaper than Cognito + custom code when you factor in developer time, _unless_ you need SSO/Directory Sync connections. SSO/directory sync connections are expensive ($125/each/month), but they're only needed for enterprise customers who typically pay enough to justify the cost.

---

## 21. Migration Assessment

### Difficulty: Medium

The migration is manageable because our architecture already separates identity (auth) from application state (lifecycle, usage, analytics). WorkOS replaces the identity layer without disturbing the application layer.

### Phase 1: AuthKit Migration (2-3 weeks)

| Task | Effort |
|------|--------|
| Replace Cognito with WorkOS AuthKit | Medium — rewrite `src/auth/provider.tsx`, `src/auth/server.ts`, `src/auth/config.ts` |
| Update `secureHandler` JWT verification | Small — switch from Cognito JWKS to WorkOS JWKS |
| Migrate users from Cognito to WorkOS | Medium — WorkOS provides migration APIs |
| Update `getOrCreateUser` to use WorkOS user ID | Small |
| Remove `/api/auth/session` cookie endpoint | Small — AuthKit SDK handles cookies |
| Update React Native auth provider | Medium — same scope as web |

### Phase 2: RBAC Migration (1-2 weeks)

| Task | Effort |
|------|--------|
| Define roles/permissions in WorkOS Dashboard | Small |
| Remove custom `org_memberships` table (WorkOS manages memberships) | Medium |
| Update `secureHandler` to read role/permissions from JWT claims | Small |
| Keep `_own` permission checks (app-level) | None — unchanged |
| Migrate org membership data to WorkOS | Medium |

### Phase 3: Enterprise Features (ongoing, per customer)

| Task | Effort |
|------|--------|
| Configure SSO for enterprise customer | Small (Admin Portal self-service) |
| Configure Directory Sync | Small (Admin Portal self-service) |
| Enable Radar | Small (toggle in dashboard) |

### What Does NOT Change

- All Aurora tables (lifecycle, usage, analytics, compliance)
- All DynamoDB tables (events, rate limits, counters)
- All Lambda functions (aggregation, retention, purge)
- All client-side hooks (usage, analytics, quotas, compliance)
- All mobile-specific code
- RLS policies (still org-scoped)
- `secureHandler` structure (same 8-step pipeline, different auth source)

---

## 22. Recommendation

### Adopt WorkOS for identity. Keep custom for operations.

**Why WorkOS for identity**:
1. AuthKit is free up to 1M MAU (eliminates Cognito cost)
2. Enterprise SSO/SCIM is their core competency and would take months to build
3. RBAC with JWT claims eliminates a database query per request
4. Radar provides security capabilities we haven't designed
5. Removes highest-risk custom code (auth is the most security-critical module)
6. The Admin Portal is a significant feature for enterprise sales

**Why keep custom for operations**:
1. WorkOS has no usage metering, quotas, analytics, or compliance features
2. These systems are deeply application-specific
3. They're already designed and most of the infrastructure (DynamoDB, Kinesis, Lambda) is standard AWS
4. No third-party vendor covers this full scope for a vertical SaaS app

### Recommended Timeline

```
Month 1    ─── AuthKit migration (replace Cognito)
                └── Ship passkeys, magic links, social login as new features

Month 2    ─── RBAC migration (replace custom roles/permissions)
                └── Org-level custom roles as a new enterprise feature

Month 3+   ─── Enable SSO/SCIM per enterprise customer
                └── Each connection is a sales-driven decision

Ongoing    ─── Build out usage/analytics/compliance (unchanged from design docs)
```
