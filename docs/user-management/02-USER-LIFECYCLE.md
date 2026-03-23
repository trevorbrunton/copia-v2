# Chapter 2: User Lifecycle Management

## Implementation Status

> **Partially implemented.** Core user lifecycle is working in production using the single-user tenant model (no RBAC/orgs).
>
> ### What's implemented
> - User statuses: `active`, `suspended`, `soft_deleted` (status check in `requireAuthContext`)
> - Profile fields: `avatarUrl`, `timezone`, `locale`, `metadata`, `lastLoginAt`, `loginCount`
> - Status history tracking (`user_status_history` table)
> - Self-service account deletion with 30-day grace period
> - Login recording on session creation
> - Settings UI with Profile, Security, and Account tabs
> - Account status overlay (suspended/deleted) with forced sign-out
>
> ### Key differences from this design
> | This design | Actual implementation |
> |-------------|---------------------|
> | Statuses: `pending`, `active`, `suspended`, `soft_deleted`, `purged` | Statuses: `active`, `suspended`, `soft_deleted` only |
> | Migration `009_extend_users_table.sql` + `010_create_user_status_history.sql` | Single migration `005_user_lifecycle_and_sessions.sql` |
> | `status_changed_by` column on users table | Not implemented (tracked in `user_status_history.changed_by` instead) |
> | `org_id` on `user_status_history` | Not implemented (no orgs yet) |
> | Self-restore from `soft_deleted` | Not supported — admin only (UX says "contact support") |
> | Org membership removal on delete | Not applicable (no orgs yet) |
> | API routes under `/api/orgs/[orgId]/users/...` | Routes under `/api/user/...` (single-user tenant) |
> | RBAC permissions for suspend/reactivate | Admin operations deferred until RBAC |
> | `forbidden()` returns `{ error, code }` | `forbidden()` returns `{ error, code, reason }` |
>
> ### Not yet implemented
> - `pending` status (email verification handled by Cognito directly)
> - `purged` status and automated purge pipeline (Lambda cron)
> - Account merge
> - User profile service with org-scoped user lists (requires RBAC)
> - Admin-initiated suspend/reactivate API routes (requires RBAC permissions)
>
> ### Actual files
> - Schema: `src/db/schema.ts` (users table extensions + `userStatusHistory`)
> - Migration: `src/db/migrations/005_user_lifecycle_and_sessions.sql`
> - Service: `src/services/user-lifecycle-service.ts`
> - API: `app/api/user/account/route.ts` (self-service deletion)
> - UI: `components/settings/profile-tab.tsx`, `components/settings/account-tab.tsx`

## 2.1 User Status Machine

Every user account has a status that governs what they can do. The status is stored in Supabase PostgreSQL on the `users` table and checked on every authenticated request.

### State Diagram

```
                    ┌──────────────────────────────────────────────┐
                    │                                              │
                    ▼                                              │
              ┌──────────┐                                        │
  Sign-up ──► │  pending  │                                        │
              │          │                                        │
              └────┬─────┘                                        │
                   │ email verified                                │
                   ▼                                               │
              ┌──────────┐     admin suspends     ┌───────────┐   │
              │  active   │ ────────────────────► │ suspended  │   │
              │          │                        │           │   │
              └────┬─────┘ ◄──────────────────── └─────┬─────┘   │
                   │         admin reactivates         │          │
                   │                                    │          │
                   │  user/admin deletes                │ admin    │
                   │                                    │ deletes  │
                   ▼                                    ▼          │
              ┌──────────────────────────────────────────┐         │
              │             soft_deleted                  │         │
              │                                          │         │
              │  30-day retention window                 │         │
              └───────┬──────────────────────┬───────────┘         │
                      │                      │                     │
                      │ user requests        │ 30 days expire      │
                      │ reactivation         │                     │
                      │ (within 30 days)     ▼                     │
                      │                ┌──────────┐                │
                      │                │ purged    │                │
                      │                │ (terminal)│                │
                      │                └──────────┘                │
                      │                                            │
                      └────────────────────────────────────────────┘
                                    (back to active)
```

### Status Definitions

| Status | Can log in? | Data visible? | API access? | Billed? |
|--------|-------------|---------------|-------------|---------|
| `pending` | No | No | No | No |
| `active` | Yes | Yes | Yes | Yes |
| `suspended` | No | Yes (to admins) | No | Yes (seat occupied) |
| `soft_deleted` | No | Yes (to admins, 30 days) | No | No (seat freed) |
| `purged` | No | No (erased) | No | No |

### Status Transitions

| From | To | Trigger | Permission Required |
|------|----|---------|-------------------|
| `pending` | `active` | Email verification (Cognito callback) | None (system) |
| `active` | `suspended` | Admin action | `users:suspend` |
| `suspended` | `active` | Admin action | `users:reactivate` |
| `active` | `soft_deleted` | User self-delete or admin action | Self or `users:delete` |
| `suspended` | `soft_deleted` | Admin action | `users:delete` |
| `soft_deleted` | `active` | User requests reactivation within 30 days | None (self-service) |
| `soft_deleted` | `purged` | Automated after 30 days | System (Lambda cron) |

## 2.2 Schema Changes

### Users Table Extension

```sql
-- 009_extend_users_table.sql

ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('pending', 'active', 'suspended', 'soft_deleted', 'purged'));

ALTER TABLE users ADD COLUMN status_reason TEXT;
ALTER TABLE users ADD COLUMN status_changed_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE users ADD COLUMN status_changed_by UUID REFERENCES users(id);
ALTER TABLE users ADD COLUMN deleted_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN purge_after TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN last_login_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN login_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN avatar_url TEXT;
ALTER TABLE users ADD COLUMN timezone TEXT DEFAULT 'UTC';
ALTER TABLE users ADD COLUMN locale TEXT DEFAULT 'en';
ALTER TABLE users ADD COLUMN metadata JSONB DEFAULT '{}';

CREATE INDEX idx_users_status ON users(status);
CREATE INDEX idx_users_purge_after ON users(purge_after) WHERE purge_after IS NOT NULL;
CREATE INDEX idx_users_last_login ON users(last_login_at);
```

### User Status History Table

Every status change is recorded for audit and compliance purposes.

```sql
-- 010_create_user_status_history.sql

CREATE TABLE user_status_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id),
  org_id          UUID REFERENCES organizations(id),
  previous_status TEXT NOT NULL,
  new_status      TEXT NOT NULL,
  reason          TEXT,
  changed_by      UUID REFERENCES users(id),
  ip_address      TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_user_status_history_user ON user_status_history(user_id);
CREATE INDEX idx_user_status_history_org  ON user_status_history(org_id);
CREATE INDEX idx_user_status_history_date ON user_status_history(created_at);

ALTER TABLE user_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_status_history FORCE ROW LEVEL SECURITY;

CREATE POLICY user_status_history_org_isolation ON user_status_history
  USING (org_id::text = current_setting('app.current_tenant_id', true));
```

### Drizzle Schema

```typescript
// Additions to src/db/schema.ts

import { pgTable, uuid, text, timestamp, integer, jsonb } from "drizzle-orm/pg-core";

// Extended users table (modify existing)
export const users = pgTable("users", {
  id:              uuid("id").defaultRandom().primaryKey(),
  cognitoId:       text("cognito_id").notNull().unique(),
  email:           text("email").notNull().unique(),
  name:            text("name"),
  status:          text("status").notNull().default("active"),
  statusReason:    text("status_reason"),
  statusChangedAt: timestamp("status_changed_at", { withTimezone: true }).defaultNow(),
  statusChangedBy: uuid("status_changed_by").references((): AnyPgColumn => users.id),
  deletedAt:       timestamp("deleted_at", { withTimezone: true }),
  purgeAfter:      timestamp("purge_after", { withTimezone: true }),
  lastLoginAt:     timestamp("last_login_at", { withTimezone: true }),
  loginCount:      integer("login_count").notNull().default(0),
  avatarUrl:       text("avatar_url"),
  timezone:        text("timezone").default("UTC"),
  locale:          text("locale").default("en"),
  metadata:        jsonb("metadata").default({}),
  createdAt:       timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const userStatusHistory = pgTable("user_status_history", {
  id:             uuid("id").defaultRandom().primaryKey(),
  userId:         uuid("user_id").notNull().references(() => users.id),
  orgId:          uuid("org_id").references(() => organizations.id),
  previousStatus: text("previous_status").notNull(),
  newStatus:      text("new_status").notNull(),
  reason:         text("reason"),
  changedBy:      uuid("changed_by").references(() => users.id),
  ipAddress:      text("ip_address"),
  createdAt:      timestamp("created_at", { withTimezone: true }).defaultNow(),
});
```

## 2.3 Status Check in Request Pipeline

The user status check integrates into the request pipeline as step 3, after authentication and org resolution but before permission checking. In the current architecture, this is handled by `requireAuthContext()` (see `src/server/require-auth-context.ts`) combined with the UoW pattern (see `src/server/uow/`).

```typescript
// In the request pipeline — after auth resolution:

// After step 2 (membership lookup):

// 3. Check user status
if (dbUser.status !== "active") {
  switch (dbUser.status) {
    case "pending":
      return forbidden("Account pending email verification");
    case "suspended":
      return forbidden("Account suspended", {
        code: "ACCOUNT_SUSPENDED",
        reason: dbUser.statusReason,
      });
    case "soft_deleted":
      return forbidden("Account deleted", {
        code: "ACCOUNT_DELETED",
        reactivateBy: dbUser.purgeAfter?.toISOString(),
      });
    case "purged":
      return unauthorized("Account no longer exists");
    default:
      return forbidden("Account inactive");
  }
}
```

The response includes structured error codes so the client can show appropriate UI (e.g., a "Your account has been suspended" screen with the reason, or a "Reactivate your account?" prompt for soft-deleted users).

## 2.4 User Lifecycle Service

```typescript
// src/services/user-lifecycle-service.ts

import { eq, and, lt } from "drizzle-orm";
import { users, userStatusHistory, orgMemberships } from "@/src/db/schema";
import type { TransactionClient } from "@/src/lib/tenant";

type UserStatus = "pending" | "active" | "suspended" | "soft_deleted" | "purged";

interface StatusChangeParams {
  userId: string;
  newStatus: UserStatus;
  reason?: string;
  changedBy: string;
  orgId?: string;
  ipAddress?: string;
}

export async function changeUserStatus(
  tx: TransactionClient,
  params: StatusChangeParams
) {
  const { userId, newStatus, reason, changedBy, orgId, ipAddress } = params;

  // Get current status
  const [user] = await tx
    .select({ status: users.status })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) throw new Error("User not found");

  // Validate transition
  validateTransition(user.status as UserStatus, newStatus);

  // Build update
  const updateData: Record<string, unknown> = {
    status: newStatus,
    statusReason: reason || null,
    statusChangedAt: new Date(),
    statusChangedBy: changedBy,
    updatedAt: new Date(),
  };

  if (newStatus === "soft_deleted") {
    updateData.deletedAt = new Date();
    updateData.purgeAfter = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
  }

  if (newStatus === "active" && user.status === "soft_deleted") {
    updateData.deletedAt = null;
    updateData.purgeAfter = null;
  }

  // Apply update
  const [updated] = await tx
    .update(users)
    .set(updateData)
    .where(eq(users.id, userId))
    .returning();

  // Record history
  await tx.insert(userStatusHistory).values({
    userId,
    orgId: orgId || null,
    previousStatus: user.status,
    newStatus,
    reason,
    changedBy,
    ipAddress,
  });

  return updated;
}

export async function suspendUser(
  tx: TransactionClient,
  userId: string,
  reason: string,
  changedBy: string,
  orgId: string,
  ipAddress?: string
) {
  return changeUserStatus(tx, {
    userId,
    newStatus: "suspended",
    reason,
    changedBy,
    orgId,
    ipAddress,
  });
}

export async function reactivateUser(
  tx: TransactionClient,
  userId: string,
  changedBy: string,
  orgId: string,
  ipAddress?: string
) {
  return changeUserStatus(tx, {
    userId,
    newStatus: "active",
    reason: "Reactivated by admin",
    changedBy,
    orgId,
    ipAddress,
  });
}

export async function softDeleteUser(
  tx: TransactionClient,
  userId: string,
  reason: string,
  changedBy: string,
  orgId?: string,
  ipAddress?: string
) {
  // Remove from all org memberships
  await tx
    .delete(orgMemberships)
    .where(eq(orgMemberships.userId, userId));

  return changeUserStatus(tx, {
    userId,
    newStatus: "soft_deleted",
    reason,
    changedBy,
    orgId,
    ipAddress,
  });
}

export async function getUsersAwaitingPurge(tx: TransactionClient) {
  return tx
    .select()
    .from(users)
    .where(
      and(
        eq(users.status, "soft_deleted"),
        lt(users.purgeAfter, new Date())
      )
    );
}

export async function recordLogin(
  tx: TransactionClient,
  userId: string
) {
  await tx
    .update(users)
    .set({
      lastLoginAt: new Date(),
      loginCount: sql`login_count + 1`,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));
}

// ── Transition validation ────────────────────────────

const VALID_TRANSITIONS: Record<UserStatus, UserStatus[]> = {
  pending:      ["active"],
  active:       ["suspended", "soft_deleted"],
  suspended:    ["active", "soft_deleted"],
  soft_deleted: ["active", "purged"],
  purged:       [],
};

function validateTransition(from: UserStatus, to: UserStatus) {
  if (!VALID_TRANSITIONS[from]?.includes(to)) {
    throw new Error(
      `Invalid status transition: ${from} → ${to}. ` +
      `Allowed: ${VALID_TRANSITIONS[from]?.join(", ") || "none"}`
    );
  }
}
```

## 2.5 User Profile Service

Extended user profile management beyond the basic `getUser` / `updateUser`.

```typescript
// src/services/user-profile-service.ts

import { eq, ilike, or, and, desc, sql } from "drizzle-orm";
import { users, orgMemberships, userStatusHistory } from "@/src/db/schema";
import type { TransactionClient } from "@/src/lib/tenant";

interface UserProfile {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  status: string;
  timezone: string;
  locale: string;
  lastLoginAt: string | null;
  loginCount: number;
  createdAt: string;
  role?: string;  // Within the current org
}

interface UserListFilters {
  search?: string;
  status?: string;
  role?: string;
  limit?: number;
  offset?: number;
  sortBy?: "name" | "email" | "lastLoginAt" | "createdAt";
  sortOrder?: "asc" | "desc";
}

export async function listOrgUsers(
  tx: TransactionClient,
  orgId: string,
  filters: UserListFilters = {}
): Promise<{ users: UserProfile[]; total: number }> {
  const {
    search,
    status,
    role,
    limit = 50,
    offset = 0,
    sortBy = "name",
    sortOrder = "asc",
  } = filters;

  let query = tx
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      avatarUrl: users.avatarUrl,
      status: users.status,
      timezone: users.timezone,
      locale: users.locale,
      lastLoginAt: users.lastLoginAt,
      loginCount: users.loginCount,
      createdAt: users.createdAt,
      role: orgMemberships.role,
    })
    .from(users)
    .innerJoin(orgMemberships, eq(users.id, orgMemberships.userId))
    .where(eq(orgMemberships.orgId, orgId))
    .$dynamic();

  // Apply filters
  const conditions = [eq(orgMemberships.orgId, orgId)];

  if (search) {
    conditions.push(
      or(
        ilike(users.name, `%${search}%`),
        ilike(users.email, `%${search}%`)
      )!
    );
  }

  if (status) {
    conditions.push(eq(users.status, status));
  }

  if (role) {
    conditions.push(eq(orgMemberships.role, role));
  }

  // Count total
  const [{ count }] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(users)
    .innerJoin(orgMemberships, eq(users.id, orgMemberships.userId))
    .where(and(...conditions));

  // Fetch page
  const results = await tx
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      avatarUrl: users.avatarUrl,
      status: users.status,
      timezone: users.timezone,
      locale: users.locale,
      lastLoginAt: users.lastLoginAt,
      loginCount: users.loginCount,
      createdAt: users.createdAt,
      role: orgMemberships.role,
    })
    .from(users)
    .innerJoin(orgMemberships, eq(users.id, orgMemberships.userId))
    .where(and(...conditions))
    .orderBy(sortOrder === "desc" ? desc(users[sortBy]) : users[sortBy])
    .limit(limit)
    .offset(offset);

  return { users: results, total: count };
}

export async function getUserDetail(
  tx: TransactionClient,
  orgId: string,
  userId: string
) {
  const [profile] = await tx
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      avatarUrl: users.avatarUrl,
      status: users.status,
      statusReason: users.statusReason,
      statusChangedAt: users.statusChangedAt,
      timezone: users.timezone,
      locale: users.locale,
      lastLoginAt: users.lastLoginAt,
      loginCount: users.loginCount,
      metadata: users.metadata,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
      role: orgMemberships.role,
      memberSince: orgMemberships.createdAt,
    })
    .from(users)
    .innerJoin(orgMemberships, eq(users.id, orgMemberships.userId))
    .where(
      and(
        eq(users.id, userId),
        eq(orgMemberships.orgId, orgId)
      )
    )
    .limit(1);

  if (!profile) return null;

  // Get status history
  const history = await tx
    .select()
    .from(userStatusHistory)
    .where(eq(userStatusHistory.userId, userId))
    .orderBy(desc(userStatusHistory.createdAt))
    .limit(20);

  return { ...profile, statusHistory: history };
}

export async function updateUserProfile(
  tx: TransactionClient,
  userId: string,
  data: {
    name?: string;
    avatarUrl?: string;
    timezone?: string;
    locale?: string;
    metadata?: Record<string, unknown>;
  }
) {
  const [updated] = await tx
    .update(users)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning();

  return updated;
}
```

## 2.6 API Routes

```typescript
// app/api/orgs/[orgId]/users/route.ts

export const GET = secureHandler(
  async (request, tx, { orgId }) => {
    const url = new URL(request.url);
    const filters = {
      search: url.searchParams.get("search") || undefined,
      status: url.searchParams.get("status") || undefined,
      role: url.searchParams.get("role") || undefined,
      limit: parseInt(url.searchParams.get("limit") || "50"),
      offset: parseInt(url.searchParams.get("offset") || "0"),
      sortBy: url.searchParams.get("sortBy") as any || "name",
      sortOrder: url.searchParams.get("sortOrder") as any || "asc",
    };

    const result = await listOrgUsers(tx, orgId, filters);
    return NextResponse.json(result);
  },
  { permission: "users:list" }
);
```

```typescript
// app/api/orgs/[orgId]/users/[userId]/route.ts

export const GET = secureHandler(
  async (request, tx, { orgId }) => {
    const userId = extractParam(request, "userId");
    const detail = await getUserDetail(tx, orgId, userId);
    if (!detail) return notFound("User");
    return NextResponse.json(detail);
  },
  { permission: "users:view_detail" }
);
```

```typescript
// app/api/orgs/[orgId]/users/[userId]/suspend/route.ts

export const POST = secureHandler(
  async (request, tx, { userId: adminId, orgId }) => {
    const targetUserId = extractParam(request, "userId");
    const { reason } = await request.json();

    if (targetUserId === adminId) {
      return badRequest("Cannot suspend yourself");
    }

    const result = await suspendUser(
      tx, targetUserId, reason, adminId, orgId,
      request.headers.get("x-forwarded-for") ?? undefined
    );

    return NextResponse.json(result);
  },
  { permission: "users:suspend" }
);
```

```typescript
// app/api/orgs/[orgId]/users/[userId]/reactivate/route.ts

export const POST = secureHandler(
  async (request, tx, { userId: adminId, orgId }) => {
    const targetUserId = extractParam(request, "userId");

    const result = await reactivateUser(
      tx, targetUserId, adminId, orgId,
      request.headers.get("x-forwarded-for") ?? undefined
    );

    return NextResponse.json(result);
  },
  { permission: "users:reactivate" }
);
```

## 2.7 Automated Purge Pipeline

A scheduled Lambda runs daily to purge users whose 30-day retention window has expired.

```typescript
// lambda/purge-expired-users/index.ts

import { getUsersAwaitingPurge } from "@/src/services/user-lifecycle-service";
import { purgeUserData } from "@/src/services/compliance-service";

export async function handler() {
  const usersToDelete = await getUsersAwaitingPurge(tx);

  for (const user of usersToDelete) {
    await purgeUserData(tx, user.id); // See Chapter 8
  }

  return { purged: usersToDelete.length };
}
```

## 2.8 Login Tracking

The `recordLogin` function is called from the auth flow when a user successfully signs in. This updates `lastLoginAt` and increments `loginCount`.

```typescript
// In the auth session endpoint (POST /api/auth/session) or
// in the request handler on first request of a new session:

// After successful JWT verification + user resolution:
await recordLogin(tx, dbUser.id);
```

This data feeds into:
- **User list sorting** — "last active" sort in admin console
- **Engagement scoring** — login frequency as a signal (Chapter 6)
- **Compliance** — account inactivity detection for auto-suspension policies
