# Chapter 3: Session & Device Management

## Implementation Status

> **Partially implemented.** Session and device management is working using the single-user tenant model.
>
> ### What's implemented
> - Device detection and registration (hash-based fingerprinting)
> - Session creation on sign-in, heartbeat, end on sign-out
> - Session revocation (single + "revoke all except current")
> - Device listing and removal (cascades to sessions)
> - Login history (paginated, lazy-loaded)
> - `sessionId` persisted in `localStorage` (survives page refreshes)
> - Security tab in settings: active sessions, devices, password change
> - `endSession` vs `revokeSession` distinction for accurate login history
>
> ### Key differences from this design
> | This design | Actual implementation |
> |-------------|---------------------|
> | Migration `011_create_session_tables.sql` | Combined into `005_user_lifecycle_and_sessions.sql` |
> | `device_id TEXT UNIQUE` (localStorage UUID) | `device_fingerprint TEXT` with composite `UNIQUE(user_id, device_fingerprint)` (hash of UA+screen+platform+timezone) |
> | `boolean` for `trusted` column | `integer DEFAULT 0` (driver compatibility) |
> | Columns: `cognito_sub`, `app_version`, `push_token`, `org_id` | Not included (no orgs, mobile, or Cognito sub tracking) |
> | RLS: `app.current_user_id` + `app.is_admin` | RLS: `app.current_tenant_id` (matches existing pattern) |
> | 5-minute heartbeat interval | 15-minute heartbeat interval |
> | Concurrent session limits by plan | Not implemented (no plan tiers yet) |
> | Heartbeats stored in DynamoDB | Heartbeats update Supabase PostgreSQL directly |
> | API routes under `/api/session/...` and `/api/orgs/[orgId]/...` | Routes under `/api/user/sessions/...` and `/api/user/devices/...` |
> | `ended_reason` values include `password_change`, `session_limit_exceeded` | Values: `user_logout`, `revoked`, `expired`, `device_removed` |
>
> ### Not yet implemented
> - Concurrent session limits
> - Push token registration
> - Session validation in request pipeline (checking revoked JWTs)
> - Admin session management routes (requires RBAC)
> - Mobile-specific heartbeat (AppState-aware)
>
> ### Actual files
> - Schema: `src/db/schema.ts` (`userDevices`, `userSessions` tables)
> - Migration: `src/db/migrations/005_user_lifecycle_and_sessions.sql`
> - Service: `src/services/session-service.ts`
> - Device detection: `src/lib/device-detection.ts`
> - Hooks: `src/hooks/use-sessions.ts`
> - API: `app/api/user/sessions/route.ts`, `app/api/user/sessions/[id]/route.ts`, `app/api/user/devices/route.ts`, `app/api/user/devices/[id]/route.ts`, `app/api/user/login-history/route.ts`
> - UI: `components/settings/security-tab.tsx`, `components/settings/login-history-dialog.tsx`, `components/settings/device-icon.tsx`
> - Auth integration: `src/auth/provider.tsx` (session create/heartbeat/end), `src/auth/context.ts` (`sessionId`)

## 3.1 Why Track Sessions Beyond Cognito?

Cognito manages token issuance and refresh, but it does not track:

- Which devices a user is signed into
- How many concurrent sessions are active
- When a specific device was last active
- The ability to revoke a specific device's session without signing out everywhere

The session management layer sits on top of Cognito and provides device-level visibility and control.

## 3.2 Concepts

```
User
├── Device A (iPhone — registered 2 months ago)
│   ├── Session 1 (expired, last week)
│   └── Session 2 (active, current)
├── Device B (Chrome on MacBook — registered 6 months ago)
│   └── Session 3 (active, current)
└── Device C (Firefox on Windows — registered 1 year ago)
    └── Session 4 (revoked by admin yesterday)
```

- **Device**: A persistent identity for a browser or mobile app installation. Stored as a secure cookie (web) or in device storage (mobile).
- **Session**: A period of authenticated activity on a device. Created on login, ended on logout/expiry/revocation.
- **Heartbeat**: A periodic ping from the client indicating the session is still active. Updates `lastActiveAt`.

## 3.3 Database Schema

```sql
-- 011_create_session_tables.sql

CREATE TABLE user_devices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id       TEXT NOT NULL UNIQUE,          -- Client-generated stable ID
  device_name     TEXT,                          -- "iPhone 15 Pro", "Chrome on macOS"
  device_type     TEXT NOT NULL DEFAULT 'unknown'
                  CHECK (device_type IN ('web', 'ios', 'android', 'desktop', 'unknown')),
  os              TEXT,                          -- "iOS 17.4", "Windows 11"
  browser         TEXT,                          -- "Chrome 122", null for native
  app_version     TEXT,                          -- "1.2.0" for native apps
  push_token      TEXT,                          -- FCM/APNs token for push notifications
  trusted         BOOLEAN NOT NULL DEFAULT false,
  last_ip         TEXT,
  last_active_at  TIMESTAMPTZ DEFAULT now(),
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_user_devices_user   ON user_devices(user_id);
CREATE INDEX idx_user_devices_device ON user_devices(device_id);

CREATE TABLE user_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id       UUID REFERENCES user_devices(id) ON DELETE SET NULL,
  org_id          UUID REFERENCES organizations(id),
  status          TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'expired', 'revoked', 'logged_out')),
  ip_address      TEXT,
  user_agent      TEXT,
  cognito_sub     TEXT,                          -- Cognito session identifier
  started_at      TIMESTAMPTZ DEFAULT now(),
  last_active_at  TIMESTAMPTZ DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL,          -- Token expiry (30 days for refresh)
  ended_at        TIMESTAMPTZ,
  ended_reason    TEXT,                          -- "logout", "expired", "admin_revoke", "password_change"
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_user_sessions_user     ON user_sessions(user_id);
CREATE INDEX idx_user_sessions_device   ON user_sessions(device_id);
CREATE INDEX idx_user_sessions_status   ON user_sessions(status) WHERE status = 'active';
CREATE INDEX idx_user_sessions_expires  ON user_sessions(expires_at);

-- RLS
ALTER TABLE user_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_devices FORCE ROW LEVEL SECURITY;
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_sessions FORCE ROW LEVEL SECURITY;

-- Users can see their own devices/sessions
-- Admins can see all via org context (handled at application layer)
CREATE POLICY devices_user_isolation ON user_devices
  USING (user_id::text = current_setting('app.current_user_id', true)
         OR current_setting('app.is_admin', true) = 'true');

CREATE POLICY sessions_user_isolation ON user_sessions
  USING (user_id::text = current_setting('app.current_user_id', true)
         OR current_setting('app.is_admin', true) = 'true');
```

### Drizzle Schema

```typescript
// Additions to src/db/schema.ts

export const userDevices = pgTable("user_devices", {
  id:           uuid("id").defaultRandom().primaryKey(),
  userId:       uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  deviceId:     text("device_id").notNull().unique(),
  deviceName:   text("device_name"),
  deviceType:   text("device_type").notNull().default("unknown"),
  os:           text("os"),
  browser:      text("browser"),
  appVersion:   text("app_version"),
  pushToken:    text("push_token"),
  trusted:      boolean("trusted").notNull().default(false),
  lastIp:       text("last_ip"),
  lastActiveAt: timestamp("last_active_at", { withTimezone: true }).defaultNow(),
  createdAt:    timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const userSessions = pgTable("user_sessions", {
  id:           uuid("id").defaultRandom().primaryKey(),
  userId:       uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  deviceId:     uuid("device_id").references(() => userDevices.id, { onDelete: "set null" }),
  orgId:        uuid("org_id").references(() => organizations.id),
  status:       text("status").notNull().default("active"),
  ipAddress:    text("ip_address"),
  userAgent:    text("user_agent"),
  cognitoSub:   text("cognito_sub"),
  startedAt:    timestamp("started_at", { withTimezone: true }).defaultNow(),
  lastActiveAt: timestamp("last_active_at", { withTimezone: true }).defaultNow(),
  expiresAt:    timestamp("expires_at", { withTimezone: true }).notNull(),
  endedAt:      timestamp("ended_at", { withTimezone: true }),
  endedReason:  text("ended_reason"),
  createdAt:    timestamp("created_at", { withTimezone: true }).defaultNow(),
});
```

## 3.4 Session Service

```typescript
// src/services/session-service.ts

import { eq, and, desc } from "drizzle-orm";
import { userDevices, userSessions } from "@/src/db/schema";
import type { TransactionClient } from "@/src/lib/tenant";

// ── Device Registration ──────────────────────────────

interface RegisterDeviceParams {
  userId: string;
  deviceId: string;
  deviceName?: string;
  deviceType: "web" | "ios" | "android" | "desktop" | "unknown";
  os?: string;
  browser?: string;
  appVersion?: string;
  ipAddress?: string;
}

export async function registerDevice(
  tx: TransactionClient,
  params: RegisterDeviceParams
) {
  const existing = await tx
    .select()
    .from(userDevices)
    .where(eq(userDevices.deviceId, params.deviceId))
    .limit(1);

  if (existing.length > 0) {
    // Update existing device
    const [updated] = await tx
      .update(userDevices)
      .set({
        deviceName: params.deviceName ?? existing[0].deviceName,
        os: params.os ?? existing[0].os,
        browser: params.browser ?? existing[0].browser,
        appVersion: params.appVersion ?? existing[0].appVersion,
        lastIp: params.ipAddress,
        lastActiveAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(userDevices.deviceId, params.deviceId))
      .returning();
    return updated;
  }

  // Create new device
  const [device] = await tx
    .insert(userDevices)
    .values({
      userId: params.userId,
      deviceId: params.deviceId,
      deviceName: params.deviceName,
      deviceType: params.deviceType,
      os: params.os,
      browser: params.browser,
      appVersion: params.appVersion,
      lastIp: params.ipAddress,
    })
    .returning();

  return device;
}

// ── Session Creation ─────────────────────────────────

interface CreateSessionParams {
  userId: string;
  deviceId?: string;         // UUID of user_devices row
  orgId?: string;
  ipAddress?: string;
  userAgent?: string;
  cognitoSub?: string;
  expiresInDays?: number;
}

export async function createSession(
  tx: TransactionClient,
  params: CreateSessionParams
) {
  const expiresAt = new Date(
    Date.now() + (params.expiresInDays ?? 30) * 24 * 60 * 60 * 1000
  );

  const [session] = await tx
    .insert(userSessions)
    .values({
      userId: params.userId,
      deviceId: params.deviceId,
      orgId: params.orgId,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
      cognitoSub: params.cognitoSub,
      expiresAt,
    })
    .returning();

  return session;
}

// ── Session Queries ──────────────────────────────────

export async function getActiveSessions(
  tx: TransactionClient,
  userId: string
) {
  return tx
    .select({
      session: userSessions,
      device: userDevices,
    })
    .from(userSessions)
    .leftJoin(userDevices, eq(userSessions.deviceId, userDevices.id))
    .where(
      and(
        eq(userSessions.userId, userId),
        eq(userSessions.status, "active")
      )
    )
    .orderBy(desc(userSessions.lastActiveAt));
}

export async function getActiveSessionCount(
  tx: TransactionClient,
  userId: string
): Promise<number> {
  const [{ count }] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(userSessions)
    .where(
      and(
        eq(userSessions.userId, userId),
        eq(userSessions.status, "active")
      )
    );
  return count;
}

// ── Session Heartbeat ────────────────────────────────

export async function heartbeat(
  tx: TransactionClient,
  sessionId: string
) {
  await tx
    .update(userSessions)
    .set({ lastActiveAt: new Date() })
    .where(
      and(
        eq(userSessions.id, sessionId),
        eq(userSessions.status, "active")
      )
    );
}

// ── Session Revocation ───────────────────────────────

export async function revokeSession(
  tx: TransactionClient,
  sessionId: string,
  reason: string = "admin_revoke"
) {
  const [revoked] = await tx
    .update(userSessions)
    .set({
      status: "revoked",
      endedAt: new Date(),
      endedReason: reason,
    })
    .where(eq(userSessions.id, sessionId))
    .returning();

  return revoked;
}

export async function revokeAllSessions(
  tx: TransactionClient,
  userId: string,
  reason: string = "admin_revoke_all"
) {
  const revoked = await tx
    .update(userSessions)
    .set({
      status: "revoked",
      endedAt: new Date(),
      endedReason: reason,
    })
    .where(
      and(
        eq(userSessions.userId, userId),
        eq(userSessions.status, "active")
      )
    )
    .returning();

  return revoked;
}

export async function endSession(
  tx: TransactionClient,
  sessionId: string
) {
  return revokeSession(tx, sessionId, "logout");
}

// ── Device Management ────────────────────────────────

export async function listDevices(
  tx: TransactionClient,
  userId: string
) {
  return tx
    .select()
    .from(userDevices)
    .where(eq(userDevices.userId, userId))
    .orderBy(desc(userDevices.lastActiveAt));
}

export async function removeDevice(
  tx: TransactionClient,
  userId: string,
  deviceId: string
) {
  // Revoke all sessions on this device first
  await tx
    .update(userSessions)
    .set({
      status: "revoked",
      endedAt: new Date(),
      endedReason: "device_removed",
    })
    .where(
      and(
        eq(userSessions.deviceId, deviceId),
        eq(userSessions.status, "active")
      )
    );

  // Delete the device
  await tx
    .delete(userDevices)
    .where(
      and(
        eq(userDevices.id, deviceId),
        eq(userDevices.userId, userId)
      )
    );
}

export async function updatePushToken(
  tx: TransactionClient,
  deviceId: string,
  pushToken: string
) {
  await tx
    .update(userDevices)
    .set({ pushToken, updatedAt: new Date() })
    .where(eq(userDevices.deviceId, deviceId));
}
```

## 3.5 Concurrent Session Limits

Plans can enforce a maximum number of concurrent sessions per user:

```typescript
// In session creation logic (handler layer):

const PLAN_SESSION_LIMITS: Record<string, number> = {
  free:       3,
  starter:    5,
  pro:       10,
  enterprise: 50,
};

async function enforceSessionLimit(
  tx: TransactionClient,
  userId: string,
  orgPlan: string
) {
  const limit = PLAN_SESSION_LIMITS[orgPlan] ?? 5;
  const activeCount = await getActiveSessionCount(tx, userId);

  if (activeCount >= limit) {
    // Option A: Reject new session
    // throw new Error(`Maximum ${limit} concurrent sessions allowed`);

    // Option B: Evict oldest session (preferred UX)
    const [oldest] = await tx
      .select()
      .from(userSessions)
      .where(
        and(
          eq(userSessions.userId, userId),
          eq(userSessions.status, "active")
        )
      )
      .orderBy(userSessions.lastActiveAt)  // oldest first
      .limit(1);

    if (oldest) {
      await revokeSession(tx, oldest.id, "session_limit_exceeded");
    }
  }
}
```

## 3.6 Session Revocation on Security Events

Certain actions should force-revoke all sessions:

| Event | Action |
|-------|--------|
| Password change | Revoke all sessions except current |
| Account suspension | Revoke all sessions |
| Account deletion | Revoke all sessions |
| Admin "Force logout" | Revoke specific or all sessions |
| Cognito global sign-out | Revoke all sessions |

```typescript
// Called after password change:
export async function revokeAllExceptCurrent(
  tx: TransactionClient,
  userId: string,
  currentSessionId: string
) {
  await tx
    .update(userSessions)
    .set({
      status: "revoked",
      endedAt: new Date(),
      endedReason: "password_change",
    })
    .where(
      and(
        eq(userSessions.userId, userId),
        eq(userSessions.status, "active"),
        not(eq(userSessions.id, currentSessionId))
      )
    );
}
```

## 3.7 Client-Side Device Fingerprinting

### Web (Next.js)

```typescript
// src/lib/device-id.ts

const DEVICE_ID_KEY = "myagency_device_id";

export function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

export function getDeviceInfo() {
  const ua = navigator.userAgent;
  return {
    deviceId: getDeviceId(),
    deviceType: "web" as const,
    deviceName: detectBrowserName(ua),
    os: detectOS(ua),
    browser: detectBrowser(ua),
  };
}

function detectBrowserName(ua: string): string {
  if (ua.includes("Chrome")) return `Chrome on ${detectOS(ua)}`;
  if (ua.includes("Firefox")) return `Firefox on ${detectOS(ua)}`;
  if (ua.includes("Safari")) return `Safari on ${detectOS(ua)}`;
  return `Browser on ${detectOS(ua)}`;
}

function detectOS(ua: string): string {
  if (ua.includes("Mac OS")) return "macOS";
  if (ua.includes("Windows")) return "Windows";
  if (ua.includes("Linux")) return "Linux";
  if (ua.includes("iPhone")) return "iOS";
  if (ua.includes("Android")) return "Android";
  return "Unknown";
}

function detectBrowser(ua: string): string {
  const match = ua.match(/(Chrome|Firefox|Safari|Edge)\/(\d+)/);
  return match ? `${match[1]} ${match[2]}` : "Unknown";
}
```

### Mobile (React Native)

See Chapter 10 for the mobile-specific device fingerprinting approach using `expo-device` and `expo-application`.

## 3.8 Heartbeat Mechanism

The client sends periodic heartbeats to keep the session marked as active.

```typescript
// src/hooks/use-session-heartbeat.ts

import { useEffect, useRef } from "react";
import { apiFetch } from "@/src/lib/api-client";

const HEARTBEAT_INTERVAL = 5 * 60 * 1000; // 5 minutes

export function useSessionHeartbeat() {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const sendHeartbeat = async () => {
      try {
        await apiFetch("/api/session/heartbeat", { method: "POST" });
      } catch {
        // Heartbeat failure is non-critical
      }
    };

    // Send immediately on mount
    sendHeartbeat();

    // Then every 5 minutes
    intervalRef.current = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);
}
```

## 3.9 API Routes

```
app/api/
├── session/
│   ├── heartbeat/route.ts         # POST — update lastActiveAt
│   └── devices/
│       ├── route.ts               # GET — list my devices
│       └── [deviceId]/route.ts    # DELETE — remove device + revoke sessions
│
└── orgs/[orgId]/
    └── users/[userId]/
        └── sessions/
            ├── route.ts           # GET — list user's sessions (admin)
            └── [sessionId]/
                └── revoke/route.ts  # POST — revoke specific session (admin)
```

## 3.10 Security: Session Validation in Request Pipeline

On every authenticated request, the system can optionally validate that the session hasn't been revoked. This catches the case where an admin revokes a session but the JWT is still valid (JWTs are stateless).

```typescript
// Optional addition to the request pipeline — adds one DB query per request.
// Can be cached in memory with a short TTL for performance.

// After JWT verification:
const session = await getSessionByCognitoSub(tx, authUser.userId);
if (session && session.status === "revoked") {
  return unauthorized("Session has been revoked");
}
```

For most applications, this check is unnecessary because Cognito's `globalSignOut` invalidates refresh tokens and the 1-hour access token window is acceptable. But for high-security environments, this provides immediate revocation.
