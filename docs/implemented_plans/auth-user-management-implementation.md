# Auth & User Management System — Implementation Plan

> **Status: COMPLETE** — All 5 phases implemented and reviewed (2026-03-04).
> Additional fixes applied post-review: sessionId localStorage persistence, UX copy corrections, statusReason consistency, lazy-load login history.

## Context

The current auth system handles sign-in/up/out, token refresh, and route protection but lacks user lifecycle management, session tracking, and self-service account features. The goal is a **fully functional auth and user management system with great UX** — adapted from the design docs (Chapters 2, 3, self-service parts of 7) but **without requiring RBAC/orgs** as a prerequisite. Everything works with the current single-user tenant model.

**What users will gain:**
- Rich profile (avatar, timezone, locale)
- See & manage active sessions/devices (like Google account)
- Revoke sessions remotely / "sign out everywhere"
- Login history
- Self-service account deletion with 30-day grace period
- Password change from settings
- Graceful handling of suspended/deleted accounts

---

## Phase 1: Schema & Migration

### 1.1 Modify `src/db/schema.ts`

**Extend `users` table** with new columns (all have defaults or are nullable — backward compatible):

```
status          text "active" (default) — values: active, suspended, soft_deleted
statusReason    text (nullable)
statusChangedAt timestamptz (nullable)
deletedAt       timestamptz (nullable)
purgeAfter      timestamptz (nullable)
lastLoginAt     timestamptz (nullable)
loginCount      integer default 0
avatarUrl       text (nullable)
timezone        text default "UTC"
locale          text default "en"
metadata        jsonb (nullable)
```

**New table: `userStatusHistory`**

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| userId | uuid FK→users | |
| fromStatus | text | |
| toStatus | text | |
| reason | text (nullable) | |
| changedBy | uuid FK→users (nullable) | self for self-service |
| ipAddress | text (nullable) | |
| createdAt | timestamptz | |

**New table: `userDevices`**

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| userId | uuid FK→users CASCADE | |
| deviceFingerprint | text NOT NULL | hash of UA+screen+platform |
| deviceName | text | "Chrome on macOS" |
| deviceType | text | desktop/mobile/tablet |
| os | text | |
| browser | text | |
| trusted | integer default 0 | 0=untrusted, 1=trusted (integer for Data API compat) |
| lastIp | text | |
| lastActiveAt | timestamptz | |
| createdAt | timestamptz | |

**New table: `userSessions`**

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| userId | uuid FK→users CASCADE | |
| deviceId | uuid FK→userDevices SET NULL | |
| status | text default "active" | active/expired/revoked/logged_out |
| ipAddress | text | |
| userAgent | text | |
| startedAt | timestamptz | |
| lastActiveAt | timestamptz | |
| expiresAt | timestamptz NOT NULL | Cognito token TTL aligned |
| endedAt | timestamptz | |
| endedReason | text | user_logout/revoked/expired |
| createdAt | timestamptz | |

**Add inferred types** for all new tables (UserDevice, UserSession, UserStatusHistory, etc.)

### 1.2 Create migration `src/db/migrations/005_user_lifecycle_and_sessions.sql`

- ALTER TABLE users ADD COLUMN for each new field
- CREATE TABLE for userStatusHistory, userDevices, userSessions
- CREATE INDEX on userId columns, deviceFingerprint, session status
- ADD composite unique constraint: `UNIQUE(user_id, device_fingerprint)` on `userDevices` (not just `device_fingerprint` alone — multiple users may share a device)
- ENABLE RLS + CREATE POLICY using `user_id::text = current_setting('app.tenant_id', true)` (matches existing pattern from migration 004)
- **Note**: `userStatusHistory` RLS uses `user_id` as tenant. When RBAC is added later, admin operations changing another user's status will need a bootstrap-style policy (similar to `users_cognito_lookup`). Acceptable for now — document as known RBAC migration requirement.

### 1.3 Add `forbidden()` helper to `src/lib/api-response.ts`

```typescript
export function forbidden(message: string, code?: string) {
  return NextResponse.json({ error: message, code }, { status: 403 });
}
```

Also add `getClientIp(request)` utility:

```typescript
export function getClientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")
    || "unknown";
}
```

### Files
- **Modify**: `src/db/schema.ts`, `src/lib/api-response.ts`
- **Create**: `src/db/migrations/005_user_lifecycle_and_sessions.sql`

---

## Phase 2: User Lifecycle Service + secureHandler Integration

### 2.1 Create `src/services/user-lifecycle-service.ts`

Following existing service pattern `(tx: TransactionClient, userId: string, ...)`.

**Important**: Profile reads/updates stay in `user-service.ts` (single ownership of the `users` table for profile fields). This service owns only status operations and login tracking.

```typescript
// Status machine
suspendUser(tx, userId, reason, changedBy, ipAddress?) → User
reactivateUser(tx, userId, changedBy, ipAddress?) → User
softDeleteUser(tx, userId, reason, ipAddress?) → User
  // Sets deletedAt=now(), purgeAfter=now()+30days, status='soft_deleted'

// Internal
recordStatusChange(tx, userId, from, to, reason, changedBy, ipAddress?) → void
getUserStatusHistory(tx, userId) → UserStatusHistory[]

// Login tracking
recordLogin(tx, userId) → void
  // UPDATE users SET lastLoginAt=now(), loginCount=loginCount+1
```

**State machine rules:**
- `active` → `suspended` (needs reason)
- `suspended` → `active` (reactivation)
- `active` → `soft_deleted` (self-service deletion)
- `soft_deleted` → cannot self-restore

### 2.2 Modify `src/lib/secure-handler.ts`

Add status check between `getOrCreateUser()` (line 31-35) and `withTenantContext()` (line 38):

```typescript
// After const dbUser = await getOrCreateUser(...)
if (dbUser.status === "suspended") {
  return forbidden("Account suspended", "ACCOUNT_SUSPENDED");
}
if (dbUser.status === "soft_deleted") {
  return forbidden("Account deleted", "ACCOUNT_DELETED");
}
```

The `HandlerContext` interface is unchanged — existing routes are unaffected.

### 2.3 Modify `app/api/auth/session/route.ts` (POST handler)

After `verifyToken()` succeeds, check user status **before** setting the session cookie. This prevents suspended/deleted users from getting a valid cookie (which would let them load protected pages with broken/empty data).

```typescript
import { getOrCreateUser } from "@/src/lib/auth";
import { forbidden } from "@/src/lib/api-response";

// After const user = await verifyToken(token):
const dbUser = await getOrCreateUser(user.userId, user.email, user.name);

if (dbUser.status === "suspended") {
  return forbidden("Account suspended", "ACCOUNT_SUSPENDED");
}
if (dbUser.status === "soft_deleted") {
  return forbidden("Account deleted", "ACCOUNT_DELETED");
}

// Only set cookie for active users (existing cookie-setting logic follows)
```

**Note**: Login recording (`recordLogin`) is NOT done here — this endpoint fires on every 55-minute token refresh, not just sign-in. Login recording is handled in Phase 3's `POST /api/user/sessions`, which only fires on actual sign-in.

### 2.4 Extend `src/services/user-service.ts` and `app/api/user/route.ts`

**Extend `updateUser()` in `user-service.ts`** to accept the new profile fields (single ownership — all profile updates go through this service):

```typescript
export async function updateUser(
  tx: TransactionClient,
  userId: string,
  data: { name?: string; email?: string; avatarUrl?: string; timezone?: string; locale?: string }
): Promise<User> {
  // existing implementation unchanged
}
```

**Update PATCH handler in `app/api/user/route.ts`** with zod validation:

```typescript
const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  avatarUrl: z.string().url().max(500).optional().or(z.literal("")),
  timezone: z.string().max(50).optional(),
  locale: z.string().max(10).optional(),
}).refine(data => Object.keys(data).length > 0, "At least one field required");
```

### 2.5 Create `app/api/user/account/route.ts`

```typescript
DELETE — Self-service account deletion
  Body: { confirm: "DELETE" }
  Calls softDeleteUser(), clears session cookie
  Returns { ok: true, purgeAfter: <date> }
```

### Files
- **Create**: `src/services/user-lifecycle-service.ts`, `app/api/user/account/route.ts`
- **Modify**: `src/lib/secure-handler.ts`, `app/api/auth/session/route.ts`, `app/api/user/route.ts`, `src/services/user-service.ts`

---

## Phase 3: Session & Device Management

### 3.1 Create `src/lib/device-detection.ts`

Client-side device info from `navigator.userAgent`:

```typescript
export interface DeviceInfo {
  fingerprint: string;    // simple hash of UA+screen+platform+timezone
  deviceName: string;     // "Chrome on macOS"
  deviceType: "desktop" | "mobile" | "tablet";
  os: string;
  browser: string;
}
export function detectDevice(): DeviceInfo
```

Simple hash function (no crypto dependency needed — this is a best-effort fingerprint, not security-critical).

### 3.2 Create `src/services/session-service.ts`

```typescript
// Devices
registerDevice(tx, userId, info: DeviceInfo, ip: string) → UserDevice
  // Upsert by (userId, fingerprint) — update lastActiveAt if exists
listDevices(tx, userId) → UserDevice[]
removeDevice(tx, userId, deviceId: string) → void
  // Also revokes all sessions for that device

// Sessions
createSession(tx, userId, { deviceId?, ipAddress?, userAgent? }) → UserSession
  // expiresAt = now + 30 days (matches Cognito refresh token TTL)
listActiveSessions(tx, userId) → (UserSession & { device?: UserDevice })[]
  // JOIN with userDevices, WHERE status='active' AND expiresAt > now
heartbeat(tx, sessionId: string) → void
  // UPDATE lastActiveAt on session + device
revokeSession(tx, userId, sessionId: string, reason?: string) → void
revokeAllSessions(tx, userId, exceptSessionId?: string) → number
endSession(tx, userId, sessionId: string) → void
  // status='logged_out', endedAt=now

// History
getLoginHistory(tx, userId, limit = 20) → UserSession[]
  // Recent sessions ordered by startedAt DESC
```

### 3.3 Create API routes

**`app/api/user/sessions/route.ts`**
- `GET` — list active sessions (with device info)
- `POST` — create session (called from AuthProvider on login) — body: `{ deviceInfo, ipAddress?, userAgent? }`. **Also calls `recordLogin(tx, userId)` from `user-lifecycle-service`** — this is the only place login is recorded, since it fires only on actual sign-in (not token refresh).
- `DELETE` — revoke all except current — body: `{ currentSessionId }`

**`app/api/user/sessions/[id]/route.ts`**
- `DELETE` — revoke specific session
- `PATCH` — heartbeat (update lastActiveAt)

**`app/api/user/devices/route.ts`**
- `GET` — list devices

**`app/api/user/devices/[id]/route.ts`**
- `DELETE` — remove device + revoke its sessions

**`app/api/user/login-history/route.ts`**
- `GET` — paginated login history

### 3.4 Create `src/hooks/use-sessions.ts`

```typescript
useSessions()          // queryKey: ["sessions"], GET /api/user/sessions
useRevokeSession()     // DELETE /api/user/sessions/[id], invalidates ["sessions"]
useRevokeAllSessions() // DELETE /api/user/sessions, invalidates ["sessions"]
useDevices()           // queryKey: ["devices"], GET /api/user/devices
useRemoveDevice()      // DELETE /api/user/devices/[id], invalidates ["devices","sessions"]
useLoginHistory()      // queryKey: ["login-history"], GET /api/user/login-history
```

### 3.5 Modify `src/auth/provider.tsx`

Integrate session lifecycle and `updatePassword` into AuthProvider:

**On sign-in** (after `refreshUser()` succeeds in `signIn()`):
1. Call `detectDevice()` to get device info
2. POST `/api/user/sessions` to create session + register device
3. Store returned `sessionId` in state

**Heartbeat** (new 15-minute interval, separate from 55-min token refresh):
1. PATCH `/api/user/sessions/[sessionId]` every 15 min
2. 15-min is preferred over 5-min to reduce API load (~4 calls/hour vs ~12). Can tighten later if precise "last active" tracking is needed.

**On sign-out** (before `amplifySignOut()`):
1. End current session: DELETE `/api/user/sessions/[sessionId]` with reason "user_logout"

**Add `updatePassword`**: Import `updatePassword` from `aws-amplify/auth` and expose via AuthProvider. This is needed by the Security tab's change-password feature in Phase 4.

### 3.6 Modify `src/auth/context.ts`

Extend `AuthContextValue`:
```typescript
sessionId: string | null;
updatePassword: (oldPassword: string, newPassword: string) => Promise<void>;
```

### Files
- **Create**: `src/lib/device-detection.ts`, `src/services/session-service.ts`, `src/hooks/use-sessions.ts`, `app/api/user/sessions/route.ts`, `app/api/user/sessions/[id]/route.ts`, `app/api/user/devices/route.ts`, `app/api/user/devices/[id]/route.ts`, `app/api/user/login-history/route.ts`
- **Modify**: `src/auth/provider.tsx`, `src/auth/context.ts`

---

## Phase 4: Enhanced Settings UI

### 4.1 Extend `src/hooks/use-user.ts`

- Expand `User` interface with new fields (avatarUrl, timezone, locale, status, lastLoginAt, loginCount, createdAt)
- Extend `useUpdateUser()` mutation to accept all profile fields
- Add `useDeleteAccount()` mutation (DELETE `/api/user/account`, body: `{ confirm: "DELETE" }`)

### 4.2 Add validation schemas to `src/auth/validation.ts`

```typescript
profileUpdateSchema — name, avatarUrl (optional URL), timezone, locale
deleteAccountSchema — { confirm: z.literal("DELETE") }
changePasswordSchema — currentPassword + newPassword (reuse passwordSchema) + confirmPassword with .refine match
```

### 4.3 Replace `app/(app)/settings/page.tsx`

Tabbed layout using existing `components/ui/tabs.tsx`:

```tsx
<Tabs defaultValue="profile">
  <TabsList>
    <TabsTrigger value="profile">Profile</TabsTrigger>
    <TabsTrigger value="security">Security</TabsTrigger>
    <TabsTrigger value="account">Account</TabsTrigger>
  </TabsList>
  <TabsContent value="profile"><ProfileTab /></TabsContent>
  <TabsContent value="security"><SecurityTab /></TabsContent>
  <TabsContent value="account"><AccountTab /></TabsContent>
</Tabs>
```

### 4.4 Create `components/settings/profile-tab.tsx`

- Name input (existing pattern from current settings page)
- Avatar URL input with `Avatar` preview (existing `components/ui/avatar.tsx`)
- Timezone `Select` dropdown (existing `components/ui/select.tsx`) — common timezones list
- Locale `Select` dropdown
- Read-only: email, account created, last login, login count
- Uses `useUser()` + `useUpdateUser()` + react-hook-form + zodResolver

### 4.5 Create `components/settings/security-tab.tsx`

**Change Password section** (Card):
- Button opens `Dialog` (existing `components/ui/dialog.tsx`)
- Dialog: current password → new password → confirm → submit
- Uses Cognito's `updatePassword` via `useAuth()` (add to AuthProvider if needed)

**Active Sessions section** (Card):
- List from `useSessions()` — each shows device name, browser, OS, IP, last active (relative time)
- Current session gets a "This device" badge (matched via `useAuth().sessionId`)
- "Revoke" button on non-current sessions
- "Sign Out All Other Sessions" button at bottom
- `Skeleton` (existing `components/ui/skeleton.tsx`) for loading state

**Devices section** (Card):
- List from `useDevices()` — device name, type icon (Monitor/Smartphone from lucide-react), last active
- "Remove" button with `AlertDialog` (existing `components/ui/alert-dialog.tsx`) confirmation
- Removing a device also revokes its sessions

### 4.6 Create `components/settings/account-tab.tsx`

**Sign Out section** (Card) — moved from current settings page:
- Sign Out button with `LogOut` icon

**Danger Zone section** (Card with destructive styling):
- Warning text: "This will delete your account. You have 30 days to sign back in and reactivate."
- "Delete My Account" button → `AlertDialog` requiring typing "DELETE" to confirm
- On success: signs out, redirects to `/`

### 4.7 Create `components/settings/login-history-dialog.tsx`

- `Sheet` (existing `components/ui/sheet.tsx`) slide-in panel triggered from Security tab
- Scrollable list of past sessions via `useLoginHistory()`
- Each entry: date/time, device info, IP, how it ended (logout/expired/revoked)
- Uses `ScrollArea` (existing `components/ui/scroll-area.tsx`)

### Files
- **Create**: `components/settings/profile-tab.tsx`, `components/settings/security-tab.tsx`, `components/settings/account-tab.tsx`, `components/settings/login-history-dialog.tsx`
- **Modify**: `app/(app)/settings/page.tsx`, `src/hooks/use-user.ts`, `src/auth/validation.ts`

---

## Phase 5: Status-Aware UX

### 5.1 Modify `src/lib/api-client.ts`

Add response interceptor — after every `apiFetch`, check for 403 with account status codes:

```typescript
if (response.status === 403) {
  const cloned = response.clone();
  const body = await cloned.json().catch(() => null);
  if (body?.code === "ACCOUNT_SUSPENDED" || body?.code === "ACCOUNT_DELETED") {
    // SSR guard — apiFetch may be called server-side where window is undefined
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("account-status-error", {
        detail: { code: body.code, reason: body.reason }
      }));
    }
  }
}
```

### 5.2 Create `components/account-status-handler.tsx`

Listens for `account-status-error` custom events. Shows:

- **Suspended**: Full-screen overlay with explanation, reason (if provided), "Contact Support" text, "Sign Out" button
- **Deleted**: Full-screen overlay explaining account was deleted, "Sign Out" button

Uses `AlertDialog` (force-open, no close button — must sign out).

### 5.3 Modify `app/(app)/layout.tsx`

Add `<AccountStatusHandler />` inside the layout.

### Files
- **Create**: `components/account-status-handler.tsx`
- **Modify**: `src/lib/api-client.ts`, `app/(app)/layout.tsx`

---

## Complete File Summary

### New Files (16)

| File | Purpose |
|------|---------|
| `src/db/migrations/005_user_lifecycle_and_sessions.sql` | Schema migration |
| `src/services/user-lifecycle-service.ts` | Status machine, login tracking (no profile ops) |
| `src/services/session-service.ts` | Session & device CRUD |
| `src/lib/device-detection.ts` | Client-side device fingerprinting |
| `src/hooks/use-sessions.ts` | TanStack Query hooks for sessions/devices |
| `app/api/user/account/route.ts` | Self-service account deletion |
| `app/api/user/sessions/route.ts` | List/create/revoke-all sessions |
| `app/api/user/sessions/[id]/route.ts` | Single session revoke/heartbeat |
| `app/api/user/devices/route.ts` | List devices |
| `app/api/user/devices/[id]/route.ts` | Remove device |
| `app/api/user/login-history/route.ts` | Login history |
| `components/settings/profile-tab.tsx` | Profile editing form |
| `components/settings/security-tab.tsx` | Sessions, devices, password change |
| `components/settings/account-tab.tsx` | Sign out + account deletion |
| `components/settings/login-history-dialog.tsx` | Login history sheet |
| `components/account-status-handler.tsx` | Suspended/deleted account overlay |

### Modified Files (13)

| File | Changes |
|------|---------|
| `src/db/schema.ts` | New columns on users, 3 new tables, inferred types |
| `src/lib/api-response.ts` | Add `forbidden()`, `getClientIp()` |
| `src/lib/secure-handler.ts` | Status check (403 for suspended/deleted) |
| `src/lib/api-client.ts` | 403 account-status interceptor (with SSR guard) |
| `src/services/user-service.ts` | Extend `updateUser()` to accept avatarUrl, timezone, locale |
| `src/auth/provider.tsx` | Session create/heartbeat(15min)/end, `updatePassword` |
| `src/auth/context.ts` | Add `sessionId`, `updatePassword` to AuthContextValue |
| `src/auth/validation.ts` | Add profile/deleteAccount/changePassword schemas |
| `src/hooks/use-user.ts` | Extended User type, useDeleteAccount |
| `app/api/user/route.ts` | PATCH accepts new profile fields |
| `app/api/auth/session/route.ts` | Status check (403 for suspended/deleted before setting cookie) |
| `app/(app)/settings/page.tsx` | Replace with tabbed layout |
| `app/(app)/layout.tsx` | Add AccountStatusHandler |

---

## Phase Dependencies

```
Phase 1 (Schema)
  ↓
Phase 2 (Lifecycle + secureHandler)
  ↓
Phase 3 (Sessions & Devices)
  ↓
Phase 4 (Settings UI)    Phase 5 (Status UX)
  ↑                        ↑
  └── both depend on ──────┘── Phase 2 + 3
```

Phases 4 and 5 can be built in parallel once Phases 1-3 are complete.

---

## Verification Plan

After each phase:

1. **Phase 1**: Run `bun run db:push` — migration applies cleanly. Verify existing queries still work (all new columns have defaults). Check RLS policies with manual SQL.

2. **Phase 2**: Test secureHandler rejects suspended/deleted users with 403. Test `POST /api/auth/session` returns 403 for suspended/deleted users (no cookie set). Test profile update with new fields via `updateUser()`. Test account deletion sets correct fields and purgeAfter date.

3. **Phase 3**: Test sign-in creates session + device records. Test `POST /api/user/sessions` increments loginCount and updates lastLoginAt. Test 15-min heartbeat updates lastActiveAt. Test revoking a session. Test "revoke all except current." Test device removal cascades to sessions. Test sign-out ends session. Test `updatePassword` via AuthProvider.

4. **Phase 4**: Test settings page renders all three tabs. Test profile form saves all fields. Test session list shows current device badge. Test revoke/remove actions update UI. Test account deletion flow (dialog → confirm → sign out). Test login history displays correctly.

5. **Phase 5**: Manually set a user's status to "suspended" in DB, verify overlay appears on next API call. Verify "Sign Out" button works from overlay.

6. **End-to-end**: Sign up → sign in → verify session created → edit profile → view sessions → revoke a session → sign out → verify session ended → sign back in → delete account → verify 403 on next request.

---

## Notes

- **No RBAC dependency**: Everything uses the existing single-user tenant model. Admin features (bulk ops, impersonation, feature flags) are deferred until RBAC/orgs are implemented.
- **No new infrastructure**: No DynamoDB, Kinesis, or Lambda. Everything runs in the existing Aurora + Next.js stack.
- **Backward compatible**: All schema changes use defaults/nullable columns. Existing API routes and services continue working unchanged.
- **Future-ready**: Tables include nullable columns where org_id would go, making RBAC adoption straightforward later. `userStatusHistory` RLS will need a bootstrap policy when admins can change other users' statuses.
