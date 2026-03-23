# RBAC System Design for myAgency

A complete system design for role-based access control in a thin Next.js frontend / AWS backend architecture, built on top of the existing Cognito + Aurora + RLS foundation.

---

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [Design Goals](#2-design-goals)
3. [Conceptual Model](#3-conceptual-model)
4. [Database Schema](#4-database-schema)
5. [Permission Resolution Algorithm](#5-permission-resolution-algorithm)
6. [Server-Side Enforcement](#6-server-side-enforcement)
7. [Row-Level Security Policies](#7-row-level-security-policies)
8. [API Layer Changes](#8-api-layer-changes)
9. [Client-Side Authorization](#9-client-side-authorization)
10. [Invitation & Onboarding Flow](#10-invitation--onboarding-flow)
11. [Audit Logging](#11-audit-logging)
12. [AWS Infrastructure Changes](#12-aws-infrastructure-changes)
13. [Migration Strategy](#13-migration-strategy)
14. [Security Considerations](#14-security-considerations)
15. [Chapter: React Native + TanStack Router Adaptation](#15-react-native--tanstack-router-adaptation)

---

## 1. Problem Statement

The current system is single-tenant per user. Every row is owned by one `user_id`, enforced via PostgreSQL RLS with `app.tenant_id`. This works for personal use, but an agency app requires:

- **Organizations** — multiple users collaborate within a shared workspace.
- **Roles** — users have different levels of access (owner, admin, member, viewer).
- **Permissions** — fine-grained control over what each role can do (create projects, manage billing, invite users, delete conversations).
- **Resource scoping** — a user who belongs to multiple organizations sees only the data for their currently active organization.

The current `userId`-scoped RLS must evolve into `orgId`-scoped RLS, with an application-layer permission check on top.

---

## 2. Design Goals

| Goal | Approach |
|------|----------|
| **Least privilege** | Users get the minimum permissions needed for their role. |
| **Defense in depth** | Permissions are enforced at three layers: RLS (database), `secureHandler` (API), and UI (client). |
| **No implicit trust** | The client never determines authorization. The server always re-verifies. |
| **Auditable** | Every permission-sensitive action is logged with who, what, when, and which org. |
| **Additive permissions** | Roles define a set of granted permissions. There are no "deny" rules — if you don't have it, you can't do it. |
| **Static role definitions** | Roles and their permissions are defined in code, not in the database. This keeps the permission system predictable and version-controlled. |
| **Org-scoped isolation** | Data belonging to one organization is never visible to another, enforced at the database level. |

---

## 3. Conceptual Model

### 3.1 Entities

```
┌─────────────────────────────────────────────────────────────────┐
│                         Organization                            │
│  id, name, slug, plan, createdAt                                │
│                                                                 │
│  ┌──────────────────────┐    ┌──────────────────────┐           │
│  │   OrgMembership      │    │   OrgInvitation       │          │
│  │   userId ──► User    │    │   email, role, token   │         │
│  │   orgId  ──► Org     │    │   status, expiresAt    │         │
│  │   role   (enum)      │    └──────────────────────┘           │
│  └──────────────────────┘                                       │
│                                                                 │
│  ┌────────┐  ┌────────────────┐  ┌──────────────────┐           │
│  │Projects│  │ Conversations  │  │ Other resources  │           │
│  │orgId   │  │ orgId          │  │ orgId            │           │
│  └────────┘  └────────────────┘  └──────────────────┘           │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Roles

Roles are an ordered hierarchy. Each higher role includes all permissions of the roles below it.

```
owner          ← Full control. Can delete the org. Cannot be removed.
  ↑
admin          ← Can manage members, roles, and all resources.
  ↑
member         ← Can create and manage their own resources. Can view others'.
  ↑
viewer         ← Read-only access to all resources in the org.
```

### 3.3 Permission Map

Permissions are string constants grouped by domain. Roles map to sets of permissions.

```typescript
// Domains: org, members, projects, chat, billing

const PERMISSIONS = {
  // Organization
  "org:read":            "View organization settings",
  "org:update":          "Update organization name, settings",
  "org:delete":          "Delete the organization",

  // Members
  "members:list":        "View the member list",
  "members:invite":      "Send invitations",
  "members:remove":      "Remove a member",
  "members:change_role": "Change another member's role",

  // Projects
  "projects:list":       "View all projects in the org",
  "projects:create":     "Create new projects",
  "projects:update":     "Update any project",
  "projects:update_own": "Update projects you created",
  "projects:delete":     "Delete any project",
  "projects:delete_own": "Delete projects you created",

  // Chat
  "chat:list":           "View all conversations in the org",
  "chat:create":         "Create new conversations",
  "chat:delete":         "Delete any conversation",
  "chat:delete_own":     "Delete conversations you created",

  // Billing
  "billing:read":        "View invoices and plan",
  "billing:manage":      "Change plan, update payment method",
} as const;

type Permission = keyof typeof PERMISSIONS;
```

### 3.4 Role → Permission Mapping

```typescript
const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  viewer: [
    "org:read",
    "members:list",
    "projects:list",
    "chat:list",
  ],

  member: [
    // inherits viewer
    "org:read",
    "members:list",
    "projects:list",
    "projects:create",
    "projects:update_own",
    "projects:delete_own",
    "chat:list",
    "chat:create",
    "chat:delete_own",
  ],

  admin: [
    // inherits member
    "org:read",
    "org:update",
    "members:list",
    "members:invite",
    "members:remove",
    "members:change_role",
    "projects:list",
    "projects:create",
    "projects:update",
    "projects:delete",
    "chat:list",
    "chat:create",
    "chat:delete",
    "billing:read",
  ],

  owner: [
    // all permissions
    "org:read",
    "org:update",
    "org:delete",
    "members:list",
    "members:invite",
    "members:remove",
    "members:change_role",
    "projects:list",
    "projects:create",
    "projects:update",
    "projects:delete",
    "chat:list",
    "chat:create",
    "chat:delete",
    "billing:read",
    "billing:manage",
  ],
};
```

The flat structure (no inheritance chain to resolve at runtime) is intentional. It makes permission checks a single `Set.has()` call and keeps the mapping auditable by reading one array.

---

## 4. Database Schema

### 4.1 New Tables

```sql
-- 005_create_organizations.sql

-- Organizations
CREATE TABLE organizations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  plan        TEXT NOT NULL DEFAULT 'free',
  created_by  UUID NOT NULL REFERENCES users(id),
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_organizations_slug ON organizations(slug);

-- Organization memberships
CREATE TABLE org_memberships (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL DEFAULT 'member'
              CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now(),

  UNIQUE (org_id, user_id)
);

CREATE INDEX idx_org_memberships_user ON org_memberships(user_id);
CREATE INDEX idx_org_memberships_org  ON org_memberships(org_id);

-- Invitations
CREATE TABLE org_invitations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'member'
              CHECK (role IN ('admin', 'member', 'viewer')),
  token       TEXT NOT NULL UNIQUE,
  invited_by  UUID NOT NULL REFERENCES users(id),
  status      TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'accepted', 'expired', 'revoked')),
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now(),

  UNIQUE (org_id, email)
);

CREATE INDEX idx_org_invitations_token ON org_invitations(token);
CREATE INDEX idx_org_invitations_email ON org_invitations(email);
```

### 4.2 Modified Tables

Add `org_id` to every resource table. The existing `user_id` stays as the creator/owner (for `_own` permission checks), but scoping shifts from `user_id` to `org_id`.

```sql
-- 006_add_org_to_resources.sql

-- Projects
ALTER TABLE projects ADD COLUMN org_id UUID REFERENCES organizations(id);
CREATE INDEX idx_projects_org ON projects(org_id);

-- Chat conversations
ALTER TABLE chat_conversations ADD COLUMN org_id UUID REFERENCES organizations(id);
CREATE INDEX idx_chat_conversations_org ON chat_conversations(org_id);

-- Chat messages inherit org scope through conversation (no direct org_id needed)
```

### 4.3 Audit Log Table

```sql
-- 007_create_audit_log.sql

CREATE TABLE audit_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id),
  user_id     UUID NOT NULL REFERENCES users(id),
  action      TEXT NOT NULL,                          -- e.g. "projects:delete"
  resource    TEXT NOT NULL,                          -- e.g. "project"
  resource_id UUID,                                   -- ID of affected resource
  metadata    JSONB DEFAULT '{}',                     -- additional context
  ip_address  TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_audit_log_org       ON audit_log(org_id);
CREATE INDEX idx_audit_log_user      ON audit_log(user_id);
CREATE INDEX idx_audit_log_created   ON audit_log(created_at);
CREATE INDEX idx_audit_log_resource  ON audit_log(resource, resource_id);
```

### 4.4 Drizzle Schema Additions

```typescript
// src/db/schema.ts (additions)

export const organizations = pgTable("organizations", {
  id:        uuid("id").defaultRandom().primaryKey(),
  name:      text("name").notNull(),
  slug:      text("slug").notNull().unique(),
  plan:      text("plan").notNull().default("free"),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const orgMemberships = pgTable("org_memberships", {
  id:        uuid("id").defaultRandom().primaryKey(),
  orgId:     uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId:    uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role:      text("role").notNull().default("member"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const orgInvitations = pgTable("org_invitations", {
  id:        uuid("id").defaultRandom().primaryKey(),
  orgId:     uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  email:     text("email").notNull(),
  role:      text("role").notNull().default("member"),
  token:     text("token").notNull().unique(),
  invitedBy: uuid("invited_by").notNull().references(() => users.id),
  status:    text("status").notNull().default("pending"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const auditLog = pgTable("audit_log", {
  id:         uuid("id").defaultRandom().primaryKey(),
  orgId:      uuid("org_id").notNull().references(() => organizations.id),
  userId:     uuid("user_id").notNull().references(() => users.id),
  action:     text("action").notNull(),
  resource:   text("resource").notNull(),
  resourceId: uuid("resource_id"),
  metadata:   jsonb("metadata").default({}),
  ipAddress:  text("ip_address"),
  createdAt:  timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// Add orgId to existing tables
// projects:          orgId: uuid("org_id").references(() => organizations.id)
// chatConversations: orgId: uuid("org_id").references(() => organizations.id)
```

### 4.5 Full Entity Relationship Diagram

```
┌──────────┐       ┌──────────────────┐       ┌──────────────────┐
│  users   │◄──────│  org_memberships │──────►│  organizations   │
│          │ M    N│                  │N     1│                  │
│ id       │       │ id               │       │ id               │
│ cognitoId│       │ org_id      ─────┼──────►│ name             │
│ email    │       │ user_id     ─────┼──►    │ slug             │
│ name     │       │ role             │       │ plan             │
└────┬─────┘       └──────────────────┘       │ created_by  ─────┼──► users
     │                                        └────┬─────────────┘
     │                                             │ 1
     │         ┌───────────────────┐               │
     │         │  org_invitations  │               │
     │         │                   │               │
     │         │  org_id      ─────┼───────────────┘
     │         │  email            │
     │         │  role             │
     │         │  token            │       ┌────────────────────┐
     │         │  invited_by  ─────┼──►    │  projects          │
     │         │  status           │       │                    │
     │         │  expires_at       │       │  id                │
     │         └───────────────────┘       │  org_id   ────────►│ org
     │                                     │  user_id  ────────►│ users (creator)
     │                                     │  name, status      │
     │                                     └────────────────────┘
     │
     │         ┌────────────────────┐       ┌────────────────────┐
     │         │ chat_conversations │       │   chat_messages    │
     │         │                    │       │                    │
     └────────►│  user_id           │       │  conversation_id ─►│ conv
               │  org_id   ────────►│ org   │  user_id  ────────►│ users
               │  title             │       │  role, content     │
               └────────┬───────────┘       └────────────────────┘
                        │ 1
                        └────────────── N ──► chat_messages
```

---

## 5. Permission Resolution Algorithm

Permission checks happen in a deterministic order at the API layer. The algorithm is simple because roles are flat (no inheritance chain to walk).

### 5.1 Resolution Steps

```
1. Extract userId from JWT (already done by getServerUserFromRequest)
2. Extract orgId from:
   a. Request header: X-Org-Id (set by client on org switch)
   b. Or URL path: /api/orgs/:orgId/...
3. Look up org_memberships WHERE user_id = :userId AND org_id = :orgId
4. If no membership → 403 Forbidden
5. Map membership.role → ROLE_PERMISSIONS[role] → Set<Permission>
6. Check: permissionSet.has(requiredPermission)
   - If yes → proceed
   - If no → 403 Forbidden
7. For "_own" permissions (e.g., projects:update_own):
   - First check if user has the unrestricted permission (projects:update)
   - If not, check if user has the _own variant AND resource.user_id === userId
   - If neither → 403 Forbidden
```

### 5.2 Implementation

```typescript
// src/lib/rbac/permissions.ts

export const ROLES = ["owner", "admin", "member", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = { /* ... as defined in Section 3.3 ... */ } as const;
export type Permission = keyof typeof PERMISSIONS;

const ROLE_PERMISSIONS: Record<Role, Set<Permission>> = {
  viewer: new Set([ /* ... */ ]),
  member: new Set([ /* ... */ ]),
  admin:  new Set([ /* ... */ ]),
  owner:  new Set([ /* ... */ ]),
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}

export function hasAnyPermission(role: Role, permissions: Permission[]): boolean {
  const rolePerms = ROLE_PERMISSIONS[role];
  return permissions.some((p) => rolePerms?.has(p));
}

export function getPermissions(role: Role): Permission[] {
  return [...(ROLE_PERMISSIONS[role] ?? [])];
}

/**
 * Check an "_own" permission. Returns true if:
 *   1. The user has the unrestricted permission (e.g. "projects:update"), OR
 *   2. The user has the _own variant AND is the resource creator.
 */
export function hasPermissionForResource(
  role: Role,
  unrestrictedPerm: Permission,
  ownPerm: Permission,
  resourceCreatorId: string,
  currentUserId: string
): boolean {
  if (hasPermission(role, unrestrictedPerm)) return true;
  if (hasPermission(role, ownPerm) && resourceCreatorId === currentUserId) return true;
  return false;
}
```

---

## 6. Server-Side Enforcement

### 6.1 Evolved `secureHandler`

The current `secureHandler` provides `{ userId, email }` in context. The RBAC version adds `orgId`, `role`, and a permission-checking function.

```typescript
// src/lib/secure-handler.ts (RBAC version)

import { NextRequest } from "next/server";
import { getServerUserFromRequest } from "@/src/auth/server";
import { getOrCreateUser } from "./auth";
import { withTenantContext, type TransactionClient } from "./tenant";
import { unauthorized, forbidden, serverError } from "./api-response";
import { getMembership } from "@/src/services/org-service";
import {
  hasPermission,
  hasPermissionForResource,
  type Permission,
  type Role,
} from "./rbac/permissions";

interface HandlerContext {
  userId: string;
  email: string;
  orgId: string;
  role: Role;
  can: (permission: Permission) => boolean;
  canForResource: (
    unrestricted: Permission,
    own: Permission,
    creatorId: string
  ) => boolean;
}

type SecureRouteHandler = (
  request: NextRequest,
  tx: TransactionClient,
  context: HandlerContext
) => Promise<Response>;

interface SecureHandlerOptions {
  /** Permission required to access this route. Checked before handler runs. */
  permission?: Permission;
}

export function secureHandler(
  handler: SecureRouteHandler,
  options: SecureHandlerOptions = {}
) {
  return async (
    request: NextRequest,
    routeContext?: { params: Promise<Record<string, string>> }
  ): Promise<Response> => {
    try {
      // 1. Authenticate
      const authUser = await getServerUserFromRequest(request);
      if (!authUser) return unauthorized();

      // 2. Get database user
      const dbUser = await getOrCreateUser(
        authUser.userId,
        authUser.email,
        authUser.name
      );

      // 3. Resolve organization
      const orgId = resolveOrgId(request, routeContext);
      if (!orgId) return forbidden("No organization context");

      // 4. Look up membership
      const membership = await getMembership(dbUser.id, orgId);
      if (!membership) return forbidden("Not a member of this organization");

      const role = membership.role as Role;

      // 5. Check route-level permission
      if (options.permission && !hasPermission(role, options.permission)) {
        return forbidden("Insufficient permissions");
      }

      // 6. Build context helpers
      const can = (p: Permission) => hasPermission(role, p);
      const canForResource = (
        unrestricted: Permission,
        own: Permission,
        creatorId: string
      ) => hasPermissionForResource(role, unrestricted, own, creatorId, dbUser.id);

      // 7. Execute within org-scoped tenant context
      return withTenantContext(orgId, async (tx) => {
        if (routeContext?.params) await routeContext.params;

        return handler(request, tx, {
          userId: dbUser.id,
          email: dbUser.email!,
          orgId,
          role,
          can,
          canForResource,
        });
      });
    } catch (error) {
      console.error("API route error:", error);
      return serverError();
    }
  };
}

function resolveOrgId(
  request: NextRequest,
  routeContext?: { params: Promise<Record<string, string>> }
): string | null {
  // Priority 1: URL path parameter (/api/orgs/:orgId/...)
  // This will be available after routeContext.params resolves, but we need
  // it before entering the tenant context. Parse from URL directly.
  const orgMatch = request.nextUrl.pathname.match(/\/api\/orgs\/([^/]+)/);
  if (orgMatch) return orgMatch[1];

  // Priority 2: Request header (for non-org-prefixed routes)
  const headerOrgId = request.headers.get("x-org-id");
  if (headerOrgId) return headerOrgId;

  return null;
}
```

### 6.2 Comparison: Before and After

**Before (user-scoped):**
```typescript
// app/api/projects/route.ts
export const GET = secureHandler(async (request, tx, { userId }) => {
  const result = await listProjects(tx, userId);
  return NextResponse.json(result);
});
```

**After (org-scoped with RBAC):**
```typescript
// app/api/orgs/[orgId]/projects/route.ts
export const GET = secureHandler(
  async (request, tx, { orgId }) => {
    const result = await listProjects(tx, orgId);
    return NextResponse.json(result);
  },
  { permission: "projects:list" }
);

export const POST = secureHandler(
  async (request, tx, { userId, orgId }) => {
    const body = await request.json();
    const project = await createProject(tx, orgId, userId, body);
    return NextResponse.json(project, { status: 201 });
  },
  { permission: "projects:create" }
);
```

**With resource-level ownership check:**
```typescript
// app/api/orgs/[orgId]/projects/[id]/route.ts
export const DELETE = secureHandler(
  async (request, tx, { userId, orgId, canForResource }) => {
    const id = request.nextUrl.pathname.split("/").pop()!;
    const project = await getProject(tx, orgId, id);
    if (!project) return notFound();

    if (!canForResource("projects:delete", "projects:delete_own", project.userId)) {
      return forbidden("Cannot delete this project");
    }

    await deleteProject(tx, orgId, id);
    return new Response(null, { status: 204 });
  }
);
```

### 6.3 Tenant Context Evolution

The tenant context shifts from `user_id` to `org_id`:

```typescript
// src/lib/tenant.ts (updated)

export async function withTenantContext<T>(
  orgId: string,   // was userId
  fn: (tx: TransactionClient) => Promise<T>,
  timeoutMs = 30_000
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql.raw(`SET LOCAL statement_timeout = '${timeoutMs}'`)
    );
    // Scope all RLS policies to this organization
    await tx.execute(
      sql.raw(`SET LOCAL app.tenant_id = '${orgId.replace(/'/g, "''")}'`)
    );
    return fn(tx);
  });
}
```

### 6.4 Request Flow Diagram

```
Client Request
    │
    ▼
┌──────────────────────────────────────────────────────────────┐
│  secureHandler()                                             │
│                                                              │
│  ┌─────────────────────────────┐                             │
│  │ 1. AUTHENTICATE             │                             │
│  │    Bearer token / Cookie    │                             │
│  │    → verifyToken() via JWKS │                             │
│  │    → { userId, email }      │                             │
│  └──────────┬──────────────────┘                             │
│             │                                                │
│  ┌──────────▼──────────────────┐                             │
│  │ 2. IDENTIFY ORG             │                             │
│  │    URL path or X-Org-Id hdr │                             │
│  │    → orgId                  │                             │
│  └──────────┬──────────────────┘                             │
│             │                                                │
│  ┌──────────▼──────────────────┐                             │
│  │ 3. AUTHORIZE (membership)   │                             │
│  │    org_memberships lookup   │                             │
│  │    → { role }               │                             │
│  └──────────┬──────────────────┘                             │
│             │                                                │
│  ┌──────────▼──────────────────┐                             │
│  │ 4. AUTHORIZE (permission)   │                             │
│  │    ROLE_PERMISSIONS check   │                             │
│  │    → pass / 403             │                             │
│  └──────────┬──────────────────┘                             │
│             │                                                │
│  ┌──────────▼──────────────────┐                             │
│  │ 5. SET TENANT CONTEXT       │                             │
│  │    SET LOCAL app.tenant_id  │                             │
│  │    = orgId                  │                             │
│  └──────────┬──────────────────┘                             │
│             │                                                │
│  ┌──────────▼──────────────────┐                             │
│  │ 6. EXECUTE HANDLER          │                             │
│  │    Route logic runs within  │                             │
│  │    org-scoped transaction   │  ←── All queries filtered   │
│  │                             │      by RLS automatically   │
│  └──────────┬──────────────────┘                             │
│             │                                                │
│  ┌──────────▼──────────────────┐                             │
│  │ 7. AUDIT LOG (if mutating)  │                             │
│  └─────────────────────────────┘                             │
└──────────────────────────────────────────────────────────────┘
```

---

## 7. Row-Level Security Policies

### 7.1 Updated RLS Policies

The RLS policies shift from `user_id`-scoped to `org_id`-scoped. The `app.tenant_id` session variable now holds an `org_id` instead of a `user_id`.

```sql
-- 008_update_rls_for_orgs.sql

-- Drop old user-scoped policies
DROP POLICY IF EXISTS projects_tenant_isolation ON projects;
DROP POLICY IF EXISTS chat_conversations_tenant_isolation ON chat_conversations;
DROP POLICY IF EXISTS chat_messages_tenant_isolation ON chat_messages;

-- Projects: org-scoped
CREATE POLICY projects_org_isolation ON projects
  USING (org_id::text = current_setting('app.tenant_id', true));

-- Conversations: org-scoped
CREATE POLICY conversations_org_isolation ON chat_conversations
  USING (org_id::text = current_setting('app.tenant_id', true));

-- Messages: scoped through conversation (join-based)
-- Messages don't have org_id directly; they inherit from conversation.
-- RLS on chat_conversations already prevents access to wrong-org conversations.
-- For messages, we keep the existing policy that requires the conversation
-- to be accessible (cascading through the conversation's RLS).
CREATE POLICY messages_conversation_isolation ON chat_messages
  USING (
    conversation_id IN (
      SELECT id FROM chat_conversations
      WHERE org_id::text = current_setting('app.tenant_id', true)
    )
  );

-- Organization memberships: org-scoped (members can see other members)
ALTER TABLE org_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_memberships FORCE ROW LEVEL SECURITY;

CREATE POLICY memberships_org_isolation ON org_memberships
  USING (org_id::text = current_setting('app.tenant_id', true));

-- Invitations: org-scoped
ALTER TABLE org_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_invitations FORCE ROW LEVEL SECURITY;

CREATE POLICY invitations_org_isolation ON org_invitations
  USING (org_id::text = current_setting('app.tenant_id', true));

-- Audit log: org-scoped
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;

CREATE POLICY audit_log_org_isolation ON audit_log
  USING (org_id::text = current_setting('app.tenant_id', true));

-- Organizations themselves: accessible if tenant_id matches
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;

CREATE POLICY organizations_tenant_isolation ON organizations
  USING (id::text = current_setting('app.tenant_id', true));

-- Bootstrap policy: allow org lookup during membership resolution
-- (before tenant context is set)
CREATE POLICY organizations_bootstrap ON organizations
  FOR SELECT USING (true);
```

### 7.2 Defense in Depth

The three enforcement layers work together:

| Layer | What it prevents | Bypass scenario it covers |
|-------|-----------------|--------------------------|
| **RLS** (database) | Cross-org data access | A bug in application code that forgets to filter by orgId |
| **secureHandler** (API) | Unauthorized actions | A user with org access but insufficient role attempting admin actions |
| **UI** (client) | Confusion | Hiding buttons/pages the user can't use — UX only, never trusted |

Even if the API permission check has a bug, RLS ensures data never leaks across organizations. Even if RLS has a gap, the API permission check prevents unauthorized mutations within an org.

---

## 8. API Layer Changes

### 8.1 Route Structure

Org-scoped routes are nested under `/api/orgs/[orgId]/`:

```
app/api/
├── auth/session/route.ts              # Unchanged (cookie sync)
├── user/route.ts                      # Unchanged (user profile)
│
├── orgs/
│   ├── route.ts                       # GET (list my orgs), POST (create org)
│   └── [orgId]/
│       ├── route.ts                   # GET, PATCH, DELETE org
│       ├── members/
│       │   ├── route.ts               # GET (list), POST (invite)
│       │   └── [memberId]/route.ts    # PATCH (change role), DELETE (remove)
│       ├── invitations/
│       │   ├── route.ts               # GET (list pending)
│       │   └── [invitationId]/route.ts  # DELETE (revoke)
│       ├── projects/
│       │   ├── route.ts               # GET, POST
│       │   └── [id]/route.ts          # GET, PATCH, DELETE
│       └── chat/
│           ├── conversations/
│           │   ├── route.ts           # GET, POST
│           │   └── [id]/
│           │       ├── route.ts       # GET, DELETE
│           │       └── messages/route.ts  # GET
│           └── stream/route.ts        # POST (SSE)
│
└── invitations/
    └── accept/route.ts                # POST (accept by token — no org context needed)
```

### 8.2 Non-Org Routes

Some routes don't need org context:

```typescript
// GET /api/orgs — list organizations the current user belongs to
// No org context needed; queries org_memberships by userId directly.
export const GET = secureHandlerNoOrg(async (request, tx, { userId }) => {
  const orgs = await listUserOrganizations(tx, userId);
  return NextResponse.json(orgs);
});

// POST /api/invitations/accept — accept an invitation by token
// No org context needed; the invitation itself identifies the org.
export const POST = secureHandlerNoOrg(async (request, tx, { userId }) => {
  const { token } = await request.json();
  const result = await acceptInvitation(tx, userId, token);
  return NextResponse.json(result);
});
```

`secureHandlerNoOrg` is a simpler variant that authenticates but skips org resolution:

```typescript
export function secureHandlerNoOrg(handler: SimpleHandler) {
  return async (request: NextRequest): Promise<Response> => {
    const authUser = await getServerUserFromRequest(request);
    if (!authUser) return unauthorized();

    const dbUser = await getOrCreateUser(
      authUser.userId, authUser.email, authUser.name
    );

    return withBootstrapContext(async (tx) => {
      return handler(request, tx, {
        userId: dbUser.id,
        email: dbUser.email!,
      });
    });
  };
}
```

### 8.3 API Client Changes

The `apiFetch` wrapper gains an org context header:

```typescript
// src/lib/api-client.ts (addition)

let activeOrgId: string | null = null;

export function setActiveOrg(orgId: string | null) {
  activeOrgId = orgId;
}

export function getActiveOrg(): string | null {
  return activeOrgId;
}
```

The `getHeaders` function (configured at startup) includes `X-Org-Id`:

```typescript
configureApiClient({
  getHeaders: async () => {
    const headers: Record<string, string> = {};
    const orgId = getActiveOrg();
    if (orgId) headers["X-Org-Id"] = orgId;
    return headers;
  },
});
```

This header is a fallback. For org-scoped routes like `/api/orgs/:orgId/projects`, the orgId is in the URL path and takes priority. The header is useful for routes that don't have orgId in the path but still need org context.

---

## 9. Client-Side Authorization

### 9.1 Auth Context Extension

The `useAuth` hook gains org and permission awareness:

```typescript
// src/auth/context.ts (extended)

interface AuthContextValue {
  // Existing
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, name: string) => Promise<{ needsVerification: boolean }>;
  confirmSignUp: (email: string, code: string) => Promise<void>;
  resendCode: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  forgotPassword: (email: string) => Promise<void>;
  confirmResetPassword: (email: string, code: string, newPassword: string) => Promise<void>;

  // New: org context
  activeOrg: OrgContext | null;
  setActiveOrg: (org: OrgContext | null) => void;
  userOrgs: OrgContext[];
}

interface OrgContext {
  orgId: string;
  orgName: string;
  orgSlug: string;
  role: Role;
}
```

### 9.2 Permission Hook

```typescript
// src/hooks/use-permissions.ts

import { useMemo } from "react";
import { useAuth } from "@/src/auth/context";
import { hasPermission, type Permission } from "@/src/lib/rbac/permissions";

export function usePermissions() {
  const { activeOrg } = useAuth();

  return useMemo(() => {
    const role = activeOrg?.role;

    const can = (permission: Permission): boolean => {
      if (!role) return false;
      return hasPermission(role, permission);
    };

    const canAny = (...permissions: Permission[]): boolean => {
      return permissions.some(can);
    };

    return { can, canAny, role };
  }, [activeOrg]);
}
```

### 9.3 Usage in Components

```tsx
// Example: Projects page with role-aware UI

import { usePermissions } from "@/src/hooks/use-permissions";

export function ProjectsPage() {
  const { data } = useProjects();
  const { can } = usePermissions();

  return (
    <div>
      <h1>Projects</h1>

      {can("projects:create") && (
        <Button onClick={openCreateDialog}>New Project</Button>
      )}

      {data?.projects.map((project) => (
        <ProjectCard
          key={project.id}
          project={project}
          showEdit={can("projects:update") || (can("projects:update_own") && project.userId === userId)}
          showDelete={can("projects:delete") || (can("projects:delete_own") && project.userId === userId)}
        />
      ))}
    </div>
  );
}
```

### 9.4 Guard Component

A declarative wrapper for permission-gating UI sections:

```tsx
// components/require-permission.tsx

import { type Permission } from "@/src/lib/rbac/permissions";
import { usePermissions } from "@/src/hooks/use-permissions";

interface RequirePermissionProps {
  permission: Permission | Permission[];
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

export function RequirePermission({
  permission,
  fallback = null,
  children,
}: RequirePermissionProps) {
  const { can, canAny } = usePermissions();

  const allowed = Array.isArray(permission)
    ? canAny(...permission)
    : can(permission);

  return allowed ? <>{children}</> : <>{fallback}</>;
}
```

Usage:

```tsx
<RequirePermission permission="members:invite">
  <InviteMemberButton />
</RequirePermission>

<RequirePermission
  permission="billing:manage"
  fallback={<p>Contact your admin to manage billing.</p>}
>
  <BillingSettings />
</RequirePermission>
```

---

## 10. Invitation & Onboarding Flow

### 10.1 Invitation Flow

```
Admin clicks "Invite"         User receives email            User clicks link
       │                              │                            │
       ▼                              ▼                            ▼
POST /api/orgs/:id/members   ┌──────────────────┐      GET /invite?token=abc
  {email, role}               │  Hi, you've been │           │
       │                      │  invited to join  │           ▼
       ▼                      │  Acme Agency.     │      ┌──────────────┐
org_invitations row created   │                   │      │ Has account? │
  status: pending             │  [Accept Invite]  │      ├─── Yes ──────┤
  token: crypto.randomUUID()  │                   │      │              │
  expires_at: now() + 7 days  └──────────────────┘      │  Sign in     │
       │                                                 │  then POST   │
       ▼                                                 │  /accept     │
  Send email via SES                                     ├─── No ───────┤
  (or Cognito custom message)                            │              │
                                                         │  Sign up     │
                                                         │  verify      │
                                                         │  then POST   │
                                                         │  /accept     │
                                                         └──────┬───────┘
                                                                │
                                                                ▼
                                                    POST /api/invitations/accept
                                                      { token: "abc" }
                                                                │
                                                                ▼
                                                    ┌────────────────────┐
                                                    │ Validate token     │
                                                    │ Check not expired  │
                                                    │ Check not revoked  │
                                                    │ Create membership  │
                                                    │ Mark accepted      │
                                                    └────────────────────┘
```

### 10.2 Organization Creation

When a user creates their first org, they become the owner:

```typescript
export async function createOrganization(
  tx: TransactionClient,
  userId: string,
  data: { name: string; slug: string }
) {
  // Create org
  const [org] = await tx.insert(organizations).values({
    name: data.name,
    slug: data.slug,
    createdBy: userId,
  }).returning();

  // Create owner membership
  await tx.insert(orgMemberships).values({
    orgId: org.id,
    userId,
    role: "owner",
  });

  return org;
}
```

### 10.3 Solo-User Migration

Existing solo users get a "Personal" organization created automatically on first login after the migration:

```typescript
// src/lib/auth.ts (updated getOrCreateUser)

export async function getOrCreateUser(cognitoId: string, email: string, name?: string) {
  // ... existing lookup logic ...

  if (existing) {
    // Check if user has any orgs; if not, create a personal one
    const memberships = await tx
      .select()
      .from(orgMemberships)
      .where(eq(orgMemberships.userId, existing.id))
      .limit(1);

    if (memberships.length === 0) {
      await createPersonalOrg(tx, existing);
    }

    return existing;
  }

  // ... existing create logic ...
  // After creating user, also create their personal org
  await createPersonalOrg(tx, newUser);
  return newUser;
}

async function createPersonalOrg(tx: TransactionClient, user: User) {
  const slug = `personal-${user.id.slice(0, 8)}`;
  const [org] = await tx.insert(organizations).values({
    name: "Personal",
    slug,
    createdBy: user.id,
  }).returning();

  await tx.insert(orgMemberships).values({
    orgId: org.id,
    userId: user.id,
    role: "owner",
  });

  // Migrate existing resources to personal org
  await tx.update(projects)
    .set({ orgId: org.id })
    .where(eq(projects.userId, user.id));

  await tx.update(chatConversations)
    .set({ orgId: org.id })
    .where(eq(chatConversations.userId, user.id));
}
```

---

## 11. Audit Logging

### 11.1 Audit Service

```typescript
// src/services/audit-service.ts

import { auditLog } from "@/src/db/schema";
import type { TransactionClient } from "@/src/lib/tenant";

interface AuditEntry {
  orgId: string;
  userId: string;
  action: string;        // Permission string, e.g. "projects:delete"
  resource: string;       // Table/entity name, e.g. "project"
  resourceId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
}

export async function logAuditEvent(
  tx: TransactionClient,
  entry: AuditEntry
) {
  await tx.insert(auditLog).values({
    orgId: entry.orgId,
    userId: entry.userId,
    action: entry.action,
    resource: entry.resource,
    resourceId: entry.resourceId,
    metadata: entry.metadata ?? {},
    ipAddress: entry.ipAddress,
  });
}
```

### 11.2 What Gets Logged

| Action | Resource | When |
|--------|----------|------|
| `org:update` | organization | Org settings changed |
| `org:delete` | organization | Org deleted |
| `members:invite` | invitation | Invitation sent |
| `members:remove` | membership | Member removed |
| `members:change_role` | membership | Role changed (includes old + new in metadata) |
| `projects:create` | project | Project created |
| `projects:update` | project | Project updated (includes changed fields in metadata) |
| `projects:delete` | project | Project deleted |
| `chat:delete` | conversation | Conversation deleted |
| `billing:manage` | billing | Plan changed |

### 11.3 Integration with secureHandler

Audit logging can be added as a wrapper or called explicitly in handlers:

```typescript
// In a route handler
export const DELETE = secureHandler(
  async (request, tx, { userId, orgId, canForResource }) => {
    const id = getIdFromPath(request);
    const project = await getProject(tx, orgId, id);
    if (!project) return notFound();

    if (!canForResource("projects:delete", "projects:delete_own", project.userId)) {
      return forbidden();
    }

    await deleteProject(tx, orgId, id);

    await logAuditEvent(tx, {
      orgId,
      userId,
      action: "projects:delete",
      resource: "project",
      resourceId: id,
      metadata: { projectName: project.name },
      ipAddress: request.headers.get("x-forwarded-for") ?? undefined,
    });

    return new Response(null, { status: 204 });
  }
);
```

---

## 12. AWS Infrastructure Changes

### 12.1 CDK Stack Additions

```typescript
// cdk/lib/mayfly-stack.ts (additions)

// SES for invitation emails
const sesIdentity = new ses.EmailIdentity(this, "EmailIdentity", {
  identity: ses.Identity.domain("myagency.example.com"),
});

// Lambda for sending invitation emails (triggered by API or EventBridge)
const invitationEmailFn = new lambda.Function(this, "InvitationEmail", {
  runtime: lambda.Runtime.NODEJS_20_X,
  handler: "index.handler",
  code: lambda.Code.fromAsset("lambda/invitation-email"),
  environment: {
    SES_FROM_ADDRESS: "invites@myagency.example.com",
    APP_URL: "https://myagency.example.com",
  },
});
sesIdentity.grantSendEmail(invitationEmailFn);
```

### 12.2 Cognito Changes

No Cognito changes required. The RBAC system is entirely application-level. Cognito remains a pure identity provider — it answers "who is this person?" but never "what can they do?" This is by design:

- Cognito groups are too coarse for org-scoped roles (a user can have different roles in different orgs).
- Custom attributes in Cognito are limited and can't represent dynamic org membership.
- Keeping authorization in the database means role changes take effect immediately — no need to re-issue JWTs.

### 12.3 Aurora Capacity

The membership lookups add one query per request (cached per-request in serverless). For most apps this is negligible. If it becomes a bottleneck:

1. **Cache memberships in a Lambda-layer LRU** — membership changes are infrequent, so a 60-second TTL is safe.
2. **Add a read replica** — membership lookups can hit the reader.
3. **Denormalize into JWT** — add `orgId:role` to a custom Cognito claim. This trades immediacy (role changes require re-login) for zero-DB-query authorization.

---

## 13. Migration Strategy

### 13.1 Migration Phases

```
Phase 1: Schema                    Phase 2: Dual-Mode              Phase 3: Org-Only
─────────────────                  ──────────────────               ───────────────
Add org tables                     Routes accept both               Remove old routes
Add org_id columns (nullable)      /api/projects (legacy)           org_id NOT NULL
Create personal orgs for           /api/orgs/:id/projects (new)     Drop user-scoped
  existing users                   Frontend switches to new         RLS policies
Backfill org_id on resources       routes behind feature flag
Keep old RLS policies
```

### 13.2 Phase 1: Schema Migration

```sql
-- Run as a single migration

-- 1. Create new tables (organizations, org_memberships, org_invitations, audit_log)
-- 2. Add org_id columns (nullable) to projects, chat_conversations
-- 3. Backfill: create personal orgs and set org_id for all existing resources
-- 4. Add new RLS policies alongside existing ones
```

### 13.3 Phase 2: Dual-Mode Routes

Both old and new route structures work simultaneously. The old routes use `userId` context; the new routes use `orgId` context. The frontend feature-flags which to use.

### 13.4 Phase 3: Finalize

```sql
-- After frontend fully migrated:
ALTER TABLE projects ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE chat_conversations ALTER COLUMN org_id SET NOT NULL;

-- Drop legacy user-scoped RLS policies
DROP POLICY projects_tenant_isolation ON projects;
-- etc.
```

---

## 14. Security Considerations

### 14.1 Threat Model

| Threat | Mitigation |
|--------|-----------|
| **Cross-org data access** | RLS enforces org isolation at the database level. Even a bug in application code cannot leak data across orgs. |
| **Privilege escalation** | Role → permission mapping is defined in code, not in the database. A user cannot modify their own role. Only admins/owners can change roles, and they cannot grant a role higher than their own. |
| **Invitation token theft** | Tokens are single-use, expire after 7 days, and are cryptographically random UUIDs. Accepting an invitation invalidates the token. |
| **IDOR (Insecure Direct Object Reference)** | All resource access goes through RLS. Guessing a UUID for a resource in another org returns zero results, not a 403 (no information leakage). |
| **JWT replay after role change** | The JWT contains only identity (`sub`, `email`). Role is resolved from the database on every request. Changing a user's role takes effect immediately on their next API call. |
| **Owner removal** | The system prevents removing the last owner. At least one owner must remain. Transferring ownership requires adding a new owner first. |

### 14.2 Role Escalation Prevention

```typescript
// Prevent a user from granting a role higher than their own
const ROLE_HIERARCHY: Record<Role, number> = {
  viewer: 0,
  member: 1,
  admin: 2,
  owner: 3,
};

export function canAssignRole(assignerRole: Role, targetRole: Role): boolean {
  return ROLE_HIERARCHY[assignerRole] > ROLE_HIERARCHY[targetRole];
}

// In the change-role handler:
if (!canAssignRole(context.role, newRole)) {
  return forbidden("Cannot assign a role equal to or higher than your own");
}
```

### 14.3 Rate Limiting Invitations

To prevent invitation spam:

```typescript
// In POST /api/orgs/:orgId/members
const recentInvitations = await tx
  .select({ count: sql<number>`count(*)::int` })
  .from(orgInvitations)
  .where(
    and(
      eq(orgInvitations.orgId, orgId),
      gt(orgInvitations.createdAt, sql`now() - interval '1 hour'`)
    )
  );

if (recentInvitations[0].count >= 20) {
  return tooManyRequests("Maximum 20 invitations per hour");
}
```

---

## 15. React Native + TanStack Router Adaptation

This chapter covers how to implement the RBAC system in a React Native app using TanStack Router for navigation. It builds on the [React Native Integration Guide](./REACT_NATIVE_GUIDE.md), which covers the base auth, token storage, and API client setup.

### 15.1 What Changes vs. the Web App

| Concern | Web (Next.js) | Mobile (React Native + TanStack Router) |
|---------|--------------|------------------------------------------|
| Permission data source | Same — API returns role via `/api/orgs` | Same |
| Permission check logic | `src/lib/rbac/permissions.ts` — shared | Identical file, copied or symlinked |
| `usePermissions` hook | Works in React 19 | Works in React Native (no DOM dependency) |
| `RequirePermission` component | JSX — renders `{children}` | Identical — uses React, not DOM |
| Route protection | Next.js middleware + `secureHandler` | TanStack Router `beforeLoad` guards |
| Org context persistence | `localStorage` + cookie | `expo-secure-store` |
| Org switcher UI | shadcn Select in sidebar | React Native picker or bottom sheet |
| API client | `apiFetch` with `X-Org-Id` header | Same `apiFetch`, same header |

### 15.2 Shared Code (Zero Modifications)

These modules work identically on mobile:

```
src/lib/rbac/permissions.ts    ← Role definitions, hasPermission, ROLE_PERMISSIONS
src/hooks/use-permissions.ts   ← usePermissions() hook
src/lib/api-client.ts          ← apiFetch + configureApiClient + setActiveOrg
src/hooks/use-user.ts          ← useUser() / useUpdateUser()
src/hooks/use-projects.ts      ← useProjects() / CRUD mutations
src/hooks/use-chat.ts          ← useConversations() / useStreamChat()
```

### 15.3 Org Context Provider (Mobile Variant)

The mobile app needs to persist the active org across app restarts and inject the `X-Org-Id` header.

```typescript
// org/org-provider.tsx

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import * as SecureStore from "expo-secure-store";
import { setActiveOrg as setApiActiveOrg } from "../lib/api-client";
import { apiFetch } from "../lib/api-client";
import type { Role } from "../lib/rbac/permissions";

interface OrgContext {
  orgId: string;
  orgName: string;
  orgSlug: string;
  role: Role;
}

interface OrgContextValue {
  activeOrg: OrgContext | null;
  userOrgs: OrgContext[];
  isLoading: boolean;
  switchOrg: (orgId: string) => Promise<void>;
  refreshOrgs: () => Promise<void>;
}

const OrgCtx = createContext<OrgContextValue | null>(null);

export function useOrg() {
  const ctx = useContext(OrgCtx);
  if (!ctx) throw new Error("useOrg must be used within OrgProvider");
  return ctx;
}

const ACTIVE_ORG_KEY = "mayfly_active_org_id";

export function OrgProvider({ children }: { children: React.ReactNode }) {
  const [userOrgs, setUserOrgs] = useState<OrgContext[]>([]);
  const [activeOrg, setActiveOrg] = useState<OrgContext | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshOrgs = useCallback(async () => {
    const res = await apiFetch("/api/orgs");
    if (!res.ok) return;
    const orgs: OrgContext[] = await res.json();
    setUserOrgs(orgs);
    return orgs;
  }, []);

  // On mount: load orgs and restore last active org
  useEffect(() => {
    (async () => {
      try {
        const orgs = await refreshOrgs();
        if (!orgs || orgs.length === 0) return;

        const savedOrgId = await SecureStore.getItemAsync(ACTIVE_ORG_KEY);
        const savedOrg = orgs.find((o) => o.orgId === savedOrgId);
        const org = savedOrg ?? orgs[0];

        setActiveOrg(org);
        setApiActiveOrg(org.orgId);
      } finally {
        setIsLoading(false);
      }
    })();
  }, [refreshOrgs]);

  const switchOrg = useCallback(
    async (orgId: string) => {
      const org = userOrgs.find((o) => o.orgId === orgId);
      if (!org) return;

      setActiveOrg(org);
      setApiActiveOrg(org.orgId);
      await SecureStore.setItemAsync(ACTIVE_ORG_KEY, orgId);
    },
    [userOrgs]
  );

  return (
    <OrgCtx.Provider value={{ activeOrg, userOrgs, isLoading, switchOrg, refreshOrgs }}>
      {children}
    </OrgCtx.Provider>
  );
}
```

### 15.4 TanStack Router Setup

TanStack Router (for React Native) uses file-based or code-based route definitions. The RBAC integration points are `beforeLoad` guards and `context` propagation.

#### Router Context Type

```typescript
// router/context.ts

import type { Role, Permission } from "../lib/rbac/permissions";

export interface RouterContext {
  auth: {
    isAuthenticated: boolean;
    isLoading: boolean;
    userId: string | null;
  };
  org: {
    activeOrg: { orgId: string; role: Role } | null;
    isLoading: boolean;
  };
  // Helper bound to current role
  can: (permission: Permission) => boolean;
}
```

#### Root Route

```typescript
// routes/__root.tsx

import { createRootRouteWithContext } from "@tanstack/react-router";
import type { RouterContext } from "../router/context";

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
});

function RootLayout() {
  return <Outlet />;
}
```

#### Providing Context to the Router

```tsx
// App.tsx

import { RouterProvider, createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { useAuth } from "./auth/context";
import { useOrg } from "./org/org-provider";
import { hasPermission } from "./lib/rbac/permissions";

const router = createRouter({
  routeTree,
  context: undefined!, // Provided at render time
});

function InnerApp() {
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const { activeOrg, isLoading: orgLoading } = useOrg();

  const can = (permission: Permission) => {
    if (!activeOrg) return false;
    return hasPermission(activeOrg.role, permission);
  };

  return (
    <RouterProvider
      router={router}
      context={{
        auth: {
          isAuthenticated,
          isLoading: authLoading,
          userId: user?.userId ?? null,
        },
        org: {
          activeOrg: activeOrg
            ? { orgId: activeOrg.orgId, role: activeOrg.role }
            : null,
          isLoading: orgLoading,
        },
        can,
      }}
    />
  );
}
```

### 15.5 Route Guards with `beforeLoad`

TanStack Router's `beforeLoad` runs before the route renders. Use it for both authentication and permission checks.

#### Authentication Guard

```typescript
// routes/_authenticated.tsx
// Layout route — all child routes require authentication

import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: ({ context }) => {
    if (context.auth.isLoading) return; // Wait for auth to resolve
    if (!context.auth.isAuthenticated) {
      throw redirect({ to: "/sign-in" });
    }
  },
  component: AuthenticatedLayout,
});
```

#### Org-Required Guard

```typescript
// routes/_authenticated/_org.tsx
// Layout route — all child routes require an active org

import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/_org")({
  beforeLoad: ({ context }) => {
    if (context.org.isLoading) return;
    if (!context.org.activeOrg) {
      throw redirect({ to: "/create-org" });
    }
  },
  component: OrgLayout,
});
```

#### Permission Guard

```typescript
// routes/_authenticated/_org/settings.tsx

import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/_org/settings")({
  beforeLoad: ({ context }) => {
    if (!context.can("org:update")) {
      throw redirect({ to: "/dashboard" });
    }
  },
  component: SettingsScreen,
});
```

#### Permission Guard for Members Page

```typescript
// routes/_authenticated/_org/members.tsx

import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/_org/members")({
  beforeLoad: ({ context }) => {
    if (!context.can("members:list")) {
      throw redirect({ to: "/dashboard" });
    }
  },
  component: MembersScreen,
});
```

### 15.6 Route Tree Structure

```
routes/
├── __root.tsx                           # Root layout
├── sign-in.tsx                          # Public
├── sign-up.tsx                          # Public
├── verify.tsx                           # Public
├── invite.tsx                           # Public (accept invitation)
│
├── _authenticated.tsx                   # Auth guard layout
│   ├── create-org.tsx                   # No org required
│   ├── accept-invite.tsx                # No org required
│   │
│   └── _org.tsx                         # Org guard layout
│       ├── dashboard.tsx                # members:list (or any role)
│       ├── projects/
│       │   ├── index.tsx                # projects:list
│       │   └── $projectId.tsx           # projects:list (detail)
│       ├── chat/
│       │   ├── index.tsx                # chat:list
│       │   └── $conversationId.tsx      # chat:list (detail)
│       ├── members.tsx                  # members:list
│       ├── settings.tsx                 # org:update
│       └── billing.tsx                  # billing:read
```

### 15.7 Org Switcher Component

```tsx
// components/org-switcher.tsx

import { View, Text, Pressable, FlatList, Modal } from "react-native";
import { useState } from "react";
import { useOrg } from "../org/org-provider";

export function OrgSwitcher() {
  const { activeOrg, userOrgs, switchOrg } = useOrg();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Pressable onPress={() => setOpen(true)}>
        <Text>{activeOrg?.orgName ?? "Select Organization"}</Text>
        <Text style={{ fontSize: 12, color: "#888" }}>{activeOrg?.role}</Text>
      </Pressable>

      <Modal visible={open} animationType="slide" transparent>
        <View style={{ flex: 1, justifyContent: "flex-end" }}>
          <View style={{ backgroundColor: "#fff", borderTopLeftRadius: 16, borderTopRightRadius: 16 }}>
            <FlatList
              data={userOrgs}
              keyExtractor={(item) => item.orgId}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => {
                    switchOrg(item.orgId);
                    setOpen(false);
                  }}
                  style={{ padding: 16, borderBottomWidth: 1, borderColor: "#eee" }}
                >
                  <Text style={{ fontWeight: item.orgId === activeOrg?.orgId ? "bold" : "normal" }}>
                    {item.orgName}
                  </Text>
                  <Text style={{ fontSize: 12, color: "#888" }}>{item.role}</Text>
                </Pressable>
              )}
            />
          </View>
        </View>
      </Modal>
    </>
  );
}
```

### 15.8 Complete Provider Stack (Mobile)

```tsx
// App.tsx

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "./auth/provider";
import { OrgProvider } from "./org/org-provider";
import { initializeApiClient } from "./app-init";

initializeApiClient();

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5 * 60 * 1000, retry: 2 } },
});

export default function App() {
  return (
    <AuthProvider>
      <OrgProvider>
        <QueryClientProvider client={queryClient}>
          <InnerApp />    {/* Provides context to TanStack Router */}
        </QueryClientProvider>
      </OrgProvider>
    </AuthProvider>
  );
}
```

### 15.9 Mobile-Specific Considerations

#### Offline Permission Checks

When offline, the app still has the `role` from the last successful org fetch. Permission checks via `usePermissions()` / `can()` work without a network call because the role is held in memory and persisted in secure storage. What fails is the API call, not the permission check — the user sees appropriate UI elements but gets a network error on action.

#### Deep Linking to Org-Scoped Routes

If the app receives a deep link like `myagency://orgs/abc-123/projects/def-456`:

```typescript
// In TanStack Router's route definition
export const Route = createFileRoute("/_authenticated/_org/projects/$projectId")({
  beforeLoad: async ({ context, params }) => {
    // The org context may need to be switched based on the URL
    // This is handled by the _org layout guard checking against the URL
  },
});
```

For deep links that include an org ID, the `_org` layout route should compare the URL's org ID with the active org and switch if needed:

```typescript
// routes/_authenticated/_org.tsx
beforeLoad: async ({ context, location }) => {
  const urlOrgId = extractOrgIdFromPath(location.pathname);
  if (urlOrgId && context.org.activeOrg?.orgId !== urlOrgId) {
    // Switch org context to match the deep link
    await switchOrg(urlOrgId);
  }
}
```

#### Push Notification Scoping

Push notifications should include `orgId` in their payload so the app can switch to the correct org context when the user taps the notification:

```json
{
  "type": "project_updated",
  "orgId": "abc-123",
  "projectId": "def-456",
  "title": "Project 'Website Redesign' was updated"
}
```

### 15.10 Summary: Mobile vs. Web RBAC Differences

| Area | Web | Mobile |
|------|-----|--------|
| Permission definitions | `src/lib/rbac/permissions.ts` | Same file (shared) |
| `usePermissions()` hook | `src/hooks/use-permissions.ts` | Same file (shared) |
| `RequirePermission` component | JSX with `children` | Same (React, not DOM) |
| Route guard mechanism | Next.js middleware + `secureHandler` (server) | TanStack Router `beforeLoad` (client) |
| Org persistence | `localStorage` | `expo-secure-store` |
| Org switcher | shadcn `<Select>` in sidebar | Bottom sheet / modal |
| API auth header | `X-Org-Id` via `apiFetch` | Same (shared `api-client.ts`) |
| Permission source of truth | Database (checked every request by `secureHandler`) | Database (checked every request by `secureHandler`) |

The mobile app is a **pure consumer** of the RBAC system. All authorization decisions are made server-side by `secureHandler`. The client-side permission checks (`can()`, `RequirePermission`, `beforeLoad` guards) are UX optimizations — they prevent the user from seeing UI for actions they can't perform, but even if bypassed, the server rejects the request.
