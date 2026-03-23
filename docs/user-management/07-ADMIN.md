# Chapter 7: Admin Console & Operations

## Implementation Status

> **Not yet implemented.** This chapter is a design document for future work. It requires the RBAC system (organizations, roles, permissions) as a prerequisite. Self-service features from this chapter (account deletion, session management) have been implemented as part of the settings UI — see Chapters 2 and 3 for details.

## 7.1 Admin Roles

The admin console is available to users with `admin` or `owner` roles. Two levels of admin tooling exist:

| Level | Who | What they see | Permission scope |
|-------|-----|--------------|-----------------|
| **Org Admin** | Org owners/admins | Users, usage, analytics, audit log for their org | `users:*`, `analytics:*`, `admin:audit_log` |
| **Platform Admin** | Internal team (super-admin) | All orgs, platform-wide analytics, system health | `platform:*` (separate from RBAC — see 7.8) |

This chapter covers org-level admin features. Platform admin is a separate internal tool.

## 7.2 User Search & Directory

### Advanced Search

The admin user directory supports filtered, sorted, paginated search across all org members.

```typescript
// API: GET /api/orgs/[orgId]/admin/users
// Permission: users:list

interface AdminUserListParams {
  // Text search
  search?: string;              // Matches name, email

  // Filters
  status?: string[];            // ["active", "suspended"]
  role?: string[];              // ["member", "viewer"]
  segment?: string[];           // ["power", "at_risk", "inactive"]
  lastLoginBefore?: string;     // ISO date — find inactive users
  lastLoginAfter?: string;
  createdBefore?: string;
  createdAfter?: string;

  // Sorting
  sortBy?: "name" | "email" | "lastLoginAt" | "createdAt" | "engagementScore" | "loginCount";
  sortOrder?: "asc" | "desc";

  // Pagination
  limit?: number;
  offset?: number;
}
```

### User Detail View

The admin detail view for a user aggregates data from multiple subsystems:

```typescript
// API: GET /api/orgs/[orgId]/admin/users/[userId]
// Permission: users:view_detail

interface AdminUserDetail {
  // Profile
  profile: {
    id: string;
    email: string;
    name: string | null;
    avatarUrl: string | null;
    status: string;
    statusReason: string | null;
    role: string;
    timezone: string;
    locale: string;
    createdAt: string;
    memberSince: string;
  };

  // Activity
  activity: {
    lastLoginAt: string | null;
    loginCount: number;
    totalApiCalls: number;           // All time
    totalAiTokens: number;           // All time
    conversationsCreated: number;
    projectsCreated: number;
  };

  // Engagement (current month)
  engagement: {
    score: number;
    segment: string;
    activeDays: number;
    featuresUsed: string[];
  };

  // Sessions
  sessions: {
    active: number;
    devices: Array<{
      id: string;
      deviceName: string;
      deviceType: string;
      lastActiveAt: string;
    }>;
  };

  // Status history
  statusHistory: Array<{
    previousStatus: string;
    newStatus: string;
    reason: string | null;
    changedBy: string;
    createdAt: string;
  }>;

  // Recent activity timeline (last 50 actions)
  timeline: Array<{
    timestamp: string;
    action: string;
    resource: string;
    resourceId: string | null;
  }>;
}
```

## 7.3 Impersonation (Support Mode)

Impersonation allows an admin to view the application as another user without knowing their credentials. This is critical for support workflows ("I can see the bug the user is reporting").

### Security Controls

| Control | Implementation |
|---------|---------------|
| Permission required | `users:impersonate` (owner only by default) |
| Audit logged | Every impersonation start/end is recorded |
| Visual indicator | Impersonation banner displayed to impersonator |
| Time-limited | Max 1 hour, auto-expires |
| Read-only option | Configurable read-only mode (no mutations) |
| Cannot impersonate higher role | Owners can impersonate admins/members; admins cannot impersonate owners |

### Impersonation Flow

```
Admin clicks "View as user"
       │
       ▼
POST /api/orgs/:orgId/admin/impersonate
  { targetUserId, readOnly: true }
       │
       ├── Check permission: users:impersonate
       ├── Check role hierarchy: admin.role > target.role
       ├── Create impersonation session (expires in 1 hour)
       ├── Audit log: "impersonation:start"
       │
       ▼
Returns: { impersonationToken, expiresAt }
       │
       ▼
Client stores impersonation token
Client adds header: X-Impersonate-User: <targetUserId>
       │
       ▼
All subsequent API calls:
  secureHandler sees X-Impersonate-User header
    → Validates impersonation session is active
    → Sets context.userId = targetUserId
    → Sets context.isImpersonating = true
    → If readOnly: rejects POST/PATCH/DELETE
    → Adds "impersonated_by" to audit log entries
       │
       ▼
Admin clicks "End impersonation" or session expires
  POST /api/orgs/:orgId/admin/impersonate/end
    → Audit log: "impersonation:end"
    → Client removes X-Impersonate-User header
```

### Implementation in secureHandler

```typescript
// In secureHandler — after authentication, before org resolution:

const impersonateHeader = request.headers.get("x-impersonate-user");
if (impersonateHeader) {
  // Validate impersonation session
  const impSession = await getActiveImpersonation(tx, dbUser.id, impersonateHeader);
  if (!impSession) {
    return forbidden("Invalid or expired impersonation session");
  }

  // Check read-only mode
  if (impSession.readOnly && !["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    return forbidden("Impersonation session is read-only");
  }

  // Override context userId to the target user
  context.userId = impersonateHeader;
  context.impersonatedBy = dbUser.id;
  context.isImpersonating = true;
}
```

### Impersonation Table

```sql
CREATE TABLE impersonation_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(id),
  admin_user_id   UUID NOT NULL REFERENCES users(id),
  target_user_id  UUID NOT NULL REFERENCES users(id),
  read_only       BOOLEAN NOT NULL DEFAULT true,
  status          TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'ended', 'expired')),
  started_at      TIMESTAMPTZ DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL,
  ended_at        TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now()
);
```

## 7.4 Bulk Operations

Admin actions that can be applied to multiple users at once.

| Operation | Endpoint | Permission | Limits |
|-----------|----------|------------|--------|
| Bulk suspend | `POST /api/orgs/:id/admin/bulk/suspend` | `users:suspend` | Max 50 per request |
| Bulk reactivate | `POST /api/orgs/:id/admin/bulk/reactivate` | `users:reactivate` | Max 50 per request |
| Bulk role change | `POST /api/orgs/:id/admin/bulk/role` | `members:change_role` | Max 50 per request |
| Bulk remove | `POST /api/orgs/:id/admin/bulk/remove` | `members:remove` | Max 50 per request |
| Export user list | `POST /api/orgs/:id/admin/users/export` | `analytics:export` | No limit |

```typescript
// API: POST /api/orgs/[orgId]/admin/bulk/suspend

interface BulkOperationRequest {
  userIds: string[];            // Max 50
  reason?: string;
}

interface BulkOperationResult {
  succeeded: string[];
  failed: Array<{
    userId: string;
    error: string;
  }>;
  total: number;
}
```

### Bulk Operation Safety

```typescript
// src/services/admin-service.ts

export async function bulkSuspend(
  tx: TransactionClient,
  orgId: string,
  adminId: string,
  userIds: string[],
  reason: string,
  ipAddress?: string
): Promise<BulkOperationResult> {
  if (userIds.length > 50) {
    throw new Error("Maximum 50 users per bulk operation");
  }

  // Cannot suspend yourself
  const filteredIds = userIds.filter((id) => id !== adminId);

  // Cannot suspend org owners
  const owners = await tx
    .select({ userId: orgMemberships.userId })
    .from(orgMemberships)
    .where(
      and(
        eq(orgMemberships.orgId, orgId),
        eq(orgMemberships.role, "owner"),
        inArray(orgMemberships.userId, filteredIds)
      )
    );

  const ownerIds = new Set(owners.map((o) => o.userId));

  const succeeded: string[] = [];
  const failed: Array<{ userId: string; error: string }> = [];

  for (const userId of filteredIds) {
    if (ownerIds.has(userId)) {
      failed.push({ userId, error: "Cannot suspend an org owner" });
      continue;
    }

    try {
      await suspendUser(tx, userId, reason, adminId, orgId, ipAddress);
      succeeded.push(userId);
    } catch (error) {
      failed.push({
        userId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return { succeeded, failed, total: filteredIds.length };
}
```

## 7.5 Audit Log Viewer

The audit log (defined in the RBAC design) gets a rich query API for the admin console.

```typescript
// API: GET /api/orgs/[orgId]/admin/audit-log
// Permission: admin:audit_log

interface AuditLogFilters {
  userId?: string;
  action?: string;              // "projects:delete", "members:invite"
  resource?: string;            // "project", "membership"
  resourceId?: string;
  startDate?: string;
  endDate?: string;
  ipAddress?: string;
  limit?: number;
  offset?: number;
}

interface AuditLogEntry {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  action: string;
  resource: string;
  resourceId: string | null;
  metadata: Record<string, unknown>;
  ipAddress: string | null;
  impersonatedBy: string | null;  // Non-null if action was performed via impersonation
  createdAt: string;
}
```

### Audit Log Service

```typescript
// src/services/audit-service.ts (query extension)

export async function queryAuditLog(
  tx: TransactionClient,
  orgId: string,
  filters: AuditLogFilters
): Promise<{ entries: AuditLogEntry[]; total: number }> {
  const conditions = [eq(auditLog.orgId, orgId)];

  if (filters.userId) conditions.push(eq(auditLog.userId, filters.userId));
  if (filters.action) conditions.push(eq(auditLog.action, filters.action));
  if (filters.resource) conditions.push(eq(auditLog.resource, filters.resource));
  if (filters.resourceId) conditions.push(eq(auditLog.resourceId, filters.resourceId));
  if (filters.startDate) conditions.push(gte(auditLog.createdAt, new Date(filters.startDate)));
  if (filters.endDate) conditions.push(lte(auditLog.createdAt, new Date(filters.endDate)));
  if (filters.ipAddress) conditions.push(eq(auditLog.ipAddress, filters.ipAddress));

  const [{ count }] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(auditLog)
    .where(and(...conditions));

  const entries = await tx
    .select({
      id: auditLog.id,
      userId: auditLog.userId,
      userName: users.name,
      userEmail: users.email,
      action: auditLog.action,
      resource: auditLog.resource,
      resourceId: auditLog.resourceId,
      metadata: auditLog.metadata,
      ipAddress: auditLog.ipAddress,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .leftJoin(users, eq(auditLog.userId, users.id))
    .where(and(...conditions))
    .orderBy(desc(auditLog.createdAt))
    .limit(filters.limit ?? 50)
    .offset(filters.offset ?? 0);

  return { entries, total: count };
}
```

## 7.6 Feature Flags

Simple feature flag system for gradual rollouts and plan-gating.

```sql
CREATE TABLE feature_flags (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key         TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT,
  enabled     BOOLEAN NOT NULL DEFAULT false,
  rules       JSONB NOT NULL DEFAULT '[]',
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);
```

### Rule Evaluation

```typescript
// src/lib/feature-flags.ts

interface FeatureRule {
  type: "plan" | "org" | "user" | "percentage";
  value: string | string[] | number;
}

interface FeatureFlag {
  key: string;
  enabled: boolean;
  rules: FeatureRule[];
}

export function evaluateFlag(
  flag: FeatureFlag,
  context: { orgId: string; userId: string; plan: string }
): boolean {
  if (!flag.enabled) return false;
  if (flag.rules.length === 0) return true; // Enabled for everyone

  return flag.rules.some((rule) => {
    switch (rule.type) {
      case "plan":
        return Array.isArray(rule.value)
          ? rule.value.includes(context.plan)
          : rule.value === context.plan;
      case "org":
        return Array.isArray(rule.value)
          ? rule.value.includes(context.orgId)
          : rule.value === context.orgId;
      case "user":
        return Array.isArray(rule.value)
          ? rule.value.includes(context.userId)
          : rule.value === context.userId;
      case "percentage":
        // Deterministic hash based on userId
        const hash = simpleHash(context.userId);
        return hash % 100 < (rule.value as number);
      default:
        return false;
    }
  });
}

function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}
```

### Feature Flag API

```typescript
// API: GET /api/feature-flags
// Returns flags applicable to current user/org (no admin permission needed)

// API: GET /api/orgs/[orgId]/admin/feature-flags
// Permission: admin:feature_flags — lists all flags with rules

// API: PATCH /api/orgs/[orgId]/admin/feature-flags/[key]
// Permission: admin:feature_flags — update flag
```

### Client-Side Hook

```typescript
// src/hooks/use-feature-flags.ts

export function useFeatureFlags() {
  return useQuery({
    queryKey: ["feature-flags"],
    queryFn: async () => {
      const res = await apiFetch("/api/feature-flags");
      if (!res.ok) throw new Error("Failed to fetch flags");
      return res.json() as Promise<Record<string, boolean>>;
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useFeatureFlag(key: string): boolean {
  const { data } = useFeatureFlags();
  return data?.[key] ?? false;
}
```

## 7.7 API Route Structure

```
app/api/orgs/[orgId]/admin/
├── users/
│   ├── route.ts                     # GET — advanced user search
│   ├── export/route.ts              # POST — export user list
│   └── [userId]/route.ts            # GET — user detail
│
├── bulk/
│   ├── suspend/route.ts             # POST
│   ├── reactivate/route.ts          # POST
│   ├── role/route.ts                # POST
│   └── remove/route.ts              # POST
│
├── impersonate/
│   ├── route.ts                     # POST — start impersonation
│   └── end/route.ts                 # POST — end impersonation
│
├── audit-log/route.ts               # GET — query audit log
│
└── feature-flags/
    ├── route.ts                     # GET — list all flags
    └── [key]/route.ts               # PATCH — update flag
```

## 7.8 Platform Admin (Internal)

Platform-level administration is a separate internal system with its own authentication (not Cognito — internal SSO) and its own database role. It is not exposed through the public API.

Key capabilities (out of scope for this design but noted for completeness):

| Capability | Description |
|-----------|-------------|
| Org directory | Search, view, suspend, delete any org |
| Plan management | Override plans, apply credits |
| Platform analytics | Cross-org metrics, revenue, growth |
| System health | Aurora capacity, Lambda errors, Kinesis throughput |
| User lookup | Find any user by email across all orgs |
| Incident response | Emergency: suspend org, revoke all sessions, disable feature |
