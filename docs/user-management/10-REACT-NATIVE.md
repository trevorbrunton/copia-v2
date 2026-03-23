# Chapter 10: React Native & TanStack Router Adaptation

## Implementation Status

> **Not yet implemented.** This chapter is a design document for future mobile adaptation. The web implementation of sessions, devices, and account status handling (Chapters 2-3) provides the server-side API foundation that this mobile client would consume.

This chapter covers how every subsystem in the user & usage management design adapts to a React Native mobile client using TanStack Router. It builds on the [React Native Integration Guide](../REACT_NATIVE_GUIDE.md) and the [RBAC mobile chapter](../RBAC_SYSTEM_DESIGN.md#15-react-native--tanstack-router-adaptation).

## 10.1 Shared vs. Mobile-Specific Code

### Shared (copy/symlink from web — zero modifications)

| Module | Why it works unchanged |
|--------|----------------------|
| `src/lib/rbac/permissions.ts` | Pure logic, no DOM/Node dependency |
| `src/lib/plans/definitions.ts` | Pure data, no runtime dependency |
| `src/lib/api-client.ts` | Uses `fetch()`, works on React Native |
| `src/hooks/use-usage.ts` | TanStack Query + apiFetch |
| `src/hooks/use-analytics.ts` | TanStack Query + apiFetch |
| `src/hooks/use-quotas.ts` | TanStack Query + apiFetch |
| `src/hooks/use-compliance.ts` | TanStack Query + apiFetch |
| `src/hooks/use-admin.ts` | TanStack Query + apiFetch |
| `src/hooks/use-feature-flags.ts` | TanStack Query + apiFetch |

### Mobile-specific (new implementations)

| Module | What's different |
|--------|-----------------|
| Device fingerprinting | Uses `expo-device` + `expo-application` instead of `navigator.userAgent` |
| Session heartbeat | Uses `AppState` + background task instead of `setInterval` |
| Usage tracking client | Batches events and sends on app foreground |
| Quota warning UI | Native toast/banner instead of DOM component |
| Data export download | Uses `expo-file-system` + Share sheet instead of browser download |

## 10.2 Device Registration (Mobile)

Mobile devices have richer identity signals than web browsers. Use native APIs for accurate fingerprinting.

```typescript
// mobile/lib/device-info.ts

import * as Device from "expo-device";
import * as Application from "expo-application";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const DEVICE_ID_KEY = "myagency_device_id";

/**
 * Get or create a stable device identifier.
 * Persists across app reinstalls via SecureStore (iOS Keychain / Android Keystore).
 */
export async function getDeviceId(): Promise<string> {
  let id = await SecureStore.getItemAsync(DEVICE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    await SecureStore.setItemAsync(DEVICE_ID_KEY, id);
  }
  return id;
}

export async function getDeviceInfo() {
  const deviceId = await getDeviceId();

  return {
    deviceId,
    deviceType: Platform.OS === "ios" ? "ios" as const : "android" as const,
    deviceName: `${Device.manufacturer} ${Device.modelName}`,
    os: `${Platform.OS} ${Platform.Version}`,
    browser: null,  // Not applicable for native
    appVersion: Application.nativeApplicationVersion ?? "unknown",
  };
}
```

### Device Registration on Login

```typescript
// mobile/auth/provider.tsx — addition to signIn callback

const signIn = useCallback(async (email: string, password: string) => {
  const result = await amplifySignIn({ username: email, password });
  if (result.isSignedIn) {
    await refreshUser();

    // Register device after successful login
    const deviceInfo = await getDeviceInfo();
    await apiFetch("/api/session/devices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(deviceInfo),
    });
  }
}, [refreshUser]);
```

### Push Token Registration

```typescript
// mobile/hooks/use-push-notifications.ts

import * as Notifications from "expo-notifications";
import { useEffect } from "react";
import { apiFetch } from "../lib/api-client";
import { getDeviceId } from "../lib/device-info";

export function usePushNotificationRegistration() {
  useEffect(() => {
    (async () => {
      const { status } = await Notifications.requestPermissionsAsync();
      if (status !== "granted") return;

      const token = await Notifications.getExpoPushTokenAsync();
      const deviceId = await getDeviceId();

      await apiFetch("/api/session/devices/push-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceId,
          pushToken: token.data,
        }),
      });
    })();
  }, []);
}
```

## 10.3 Session Heartbeat (Mobile)

Web heartbeats use `setInterval`. Mobile heartbeats must account for app backgrounding.

```typescript
// mobile/hooks/use-session-heartbeat.ts

import { useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { apiFetch } from "../lib/api-client";

const HEARTBEAT_INTERVAL = 5 * 60 * 1000; // 5 minutes

export function useSessionHeartbeat() {
  const lastHeartbeat = useRef<number>(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const sendHeartbeat = async () => {
    const now = Date.now();
    // Don't send more often than every 4 minutes (debounce)
    if (now - lastHeartbeat.current < 4 * 60 * 1000) return;
    lastHeartbeat.current = now;

    try {
      await apiFetch("/api/session/heartbeat", { method: "POST" });
    } catch {
      // Non-critical
    }
  };

  useEffect(() => {
    // Send on mount
    sendHeartbeat();

    // Send on interval while foregrounded
    intervalRef.current = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL);

    // Send when app returns to foreground
    const subscription = AppState.addEventListener(
      "change",
      (state: AppStateStatus) => {
        if (state === "active") {
          sendHeartbeat();
        }
      }
    );

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      subscription.remove();
    };
  }, []);
}
```

## 10.4 Client-Side Usage Event Buffering

Mobile apps should buffer feature-tracking events locally and flush them in batches, since the network may be unreliable and each event is low-priority.

```typescript
// mobile/lib/usage-buffer.ts

import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState } from "react-native";
import { apiFetch } from "../lib/api-client";

const BUFFER_KEY = "myagency_usage_buffer";
const MAX_BUFFER_SIZE = 100;
const FLUSH_INTERVAL = 60_000; // 1 minute

interface BufferedEvent {
  feature: string;
  timestamp: string;
}

let buffer: BufferedEvent[] = [];

export function trackFeature(feature: string) {
  buffer.push({
    feature,
    timestamp: new Date().toISOString(),
  });

  if (buffer.length >= MAX_BUFFER_SIZE) {
    flushBuffer();
  }
}

export async function flushBuffer() {
  if (buffer.length === 0) return;

  const toFlush = [...buffer];
  buffer = [];

  try {
    await apiFetch("/api/usage/track-batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events: toFlush }),
    });
  } catch {
    // Put events back in buffer for next attempt
    buffer = [...toFlush, ...buffer].slice(0, MAX_BUFFER_SIZE);
    // Persist to AsyncStorage so events survive app restarts
    await AsyncStorage.setItem(BUFFER_KEY, JSON.stringify(buffer));
  }
}

// Restore buffer from storage on app start
export async function restoreBuffer() {
  try {
    const stored = await AsyncStorage.getItem(BUFFER_KEY);
    if (stored) {
      buffer = JSON.parse(stored);
      await AsyncStorage.removeItem(BUFFER_KEY);
    }
  } catch {
    // Ignore
  }
}

// Flush on app background
AppState.addEventListener("change", (state) => {
  if (state === "background") {
    flushBuffer();
  }
});

// Periodic flush while foregrounded
setInterval(() => {
  if (AppState.currentState === "active") {
    flushBuffer();
  }
}, FLUSH_INTERVAL);
```

### Integration in App Entry

```typescript
// mobile/App.tsx

import { restoreBuffer } from "./lib/usage-buffer";

// Restore buffered events on cold start
restoreBuffer();
```

## 10.5 TanStack Router Guards for User Status

The web app checks user status in `secureHandler` (server-side). The mobile app should also handle status responses gracefully in the router.

### Status Error Interceptor

```typescript
// mobile/lib/api-client-interceptor.ts

import { configureApiClient } from "../lib/api-client";
import { router } from "../router";

// Wrap apiFetch to intercept status-related errors
const originalApiFetch = apiFetch;

export async function interceptedApiFetch(
  input: string | URL | Request,
  init?: RequestInit
): Promise<Response> {
  const response = await originalApiFetch(input, init);

  if (response.status === 403) {
    const body = await response.clone().json().catch(() => null);

    if (body?.code === "ACCOUNT_SUSPENDED") {
      // Navigate to suspension screen
      router.navigate({ to: "/account-suspended", search: { reason: body.reason } });
      throw new Error("Account suspended");
    }

    if (body?.code === "ACCOUNT_DELETED") {
      router.navigate({
        to: "/account-deleted",
        search: { reactivateBy: body.reactivateBy },
      });
      throw new Error("Account deleted");
    }

    if (body?.code === "QUOTA_EXCEEDED") {
      // Show quota exceeded modal instead of navigating
      showQuotaExceededModal(body.quota, body.current, body.limit);
      throw new Error("Quota exceeded");
    }
  }

  if (response.status === 429) {
    const retryAfter = response.headers.get("Retry-After");
    showRateLimitToast(retryAfter ? parseInt(retryAfter) : 60);
    throw new Error("Rate limited");
  }

  return response;
}
```

### TanStack Router Status Screens

```typescript
// mobile/routes/_authenticated/account-suspended.tsx

import { createFileRoute } from "@tanstack/react-router";
import { View, Text, Button } from "react-native";
import { useAuth } from "../../auth/context";

export const Route = createFileRoute("/_authenticated/account-suspended")({
  component: AccountSuspendedScreen,
});

function AccountSuspendedScreen() {
  const { reason } = Route.useSearch();
  const { signOut } = useAuth();

  return (
    <View style={{ flex: 1, justifyContent: "center", padding: 24 }}>
      <Text style={{ fontSize: 24, fontWeight: "bold", marginBottom: 16 }}>
        Account Suspended
      </Text>
      <Text style={{ fontSize: 16, color: "#666", marginBottom: 24 }}>
        {reason || "Your account has been suspended by an administrator."}
      </Text>
      <Text style={{ fontSize: 14, color: "#888", marginBottom: 32 }}>
        Contact your organization administrator for assistance.
      </Text>
      <Button title="Sign Out" onPress={signOut} />
    </View>
  );
}
```

```typescript
// mobile/routes/_authenticated/account-deleted.tsx

export const Route = createFileRoute("/_authenticated/account-deleted")({
  component: AccountDeletedScreen,
});

function AccountDeletedScreen() {
  const { reactivateBy } = Route.useSearch();
  const { signOut } = useAuth();

  const canReactivate = reactivateBy && new Date(reactivateBy) > new Date();

  return (
    <View style={{ flex: 1, justifyContent: "center", padding: 24 }}>
      <Text style={{ fontSize: 24, fontWeight: "bold", marginBottom: 16 }}>
        Account Scheduled for Deletion
      </Text>

      {canReactivate && (
        <>
          <Text style={{ marginBottom: 16 }}>
            Your data will be permanently deleted on{" "}
            {new Date(reactivateBy).toLocaleDateString()}.
          </Text>
          <Button
            title="Reactivate Account"
            onPress={async () => {
              await apiFetch("/api/user/reactivate", { method: "POST" });
              router.navigate({ to: "/dashboard" });
            }}
          />
        </>
      )}

      <Button title="Sign Out" onPress={signOut} />
    </View>
  );
}
```

## 10.6 Quota & Rate Limit UI (Mobile)

### Quota Warning Banner

```tsx
// mobile/components/quota-warning-banner.tsx

import { View, Text, Pressable } from "react-native";
import { useQuotaWarning } from "../hooks/use-quotas";

export function QuotaWarningBanner() {
  const warning = useQuotaWarning();
  if (!warning) return null;

  const colors = {
    warning: { bg: "#FEF3C7", text: "#92400E" },
    danger:  { bg: "#FEE2E2", text: "#991B1B" },
    blocked: { bg: "#991B1B", text: "#FFFFFF" },
  };

  const style = colors[warning.severity as keyof typeof colors] ?? colors.warning;

  return (
    <View style={{ backgroundColor: style.bg, padding: 12 }}>
      <Text style={{ color: style.text, fontWeight: "600" }}>
        {warning.percentUsed}% of {formatQuotaName(warning.name)} used
      </Text>
      <Text style={{ color: style.text, fontSize: 12 }}>
        {warning.current.toLocaleString()} / {warning.limit.toLocaleString()}
      </Text>
    </View>
  );
}

function formatQuotaName(name: string): string {
  const names: Record<string, string> = {
    aiTokensPerMonth: "AI tokens",
    apiCallsPerMonth: "API calls",
    storageBytes: "storage",
    members: "team members",
    projects: "projects",
  };
  return names[name] ?? name;
}
```

### Integrate in App Layout

```tsx
// mobile/routes/_authenticated/_org.tsx

function OrgLayout() {
  return (
    <View style={{ flex: 1 }}>
      <QuotaWarningBanner />
      <Outlet />
    </View>
  );
}
```

## 10.7 Data Export Download (Mobile)

Browser downloads don't work on mobile. Use the Share sheet or save to device.

```typescript
// mobile/hooks/use-data-export-download.ts

import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import { apiFetch } from "../lib/api-client";

export function useDataExportDownload() {
  const download = async (exportId: string) => {
    // Get download URL
    const res = await apiFetch(`/api/compliance/export/${exportId}/download`);
    if (!res.ok) throw new Error("Download failed");

    const blob = await res.blob();
    const reader = new FileReader();

    return new Promise<void>((resolve, reject) => {
      reader.onload = async () => {
        try {
          const base64 = (reader.result as string).split(",")[1];
          const fileUri = `${FileSystem.cacheDirectory}data-export-${exportId}.json`;

          await FileSystem.writeAsStringAsync(fileUri, base64, {
            encoding: FileSystem.EncodingType.Base64,
          });

          // Open system share sheet
          if (await Sharing.isAvailableAsync()) {
            await Sharing.shareAsync(fileUri, {
              mimeType: "application/json",
              dialogTitle: "Save your data export",
            });
          }

          resolve();
        } catch (e) {
          reject(e);
        }
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  return { download };
}
```

## 10.8 Admin Console on Mobile

The admin console is designed as a responsive experience. On mobile, the same API endpoints and hooks are used, but the UI is adapted to native components.

### Admin User List

```tsx
// mobile/screens/admin/UserListScreen.tsx

import { FlatList, View, Text, Pressable, ActivityIndicator } from "react-native";
import { useAdminUsers } from "../../hooks/use-admin";

export function UserListScreen() {
  const { data, isLoading, fetchNextPage, hasNextPage } = useAdminUsers();

  if (isLoading) return <ActivityIndicator />;

  return (
    <FlatList
      data={data?.users}
      keyExtractor={(item) => item.id}
      onEndReached={() => hasNextPage && fetchNextPage()}
      renderItem={({ item }) => (
        <Pressable
          onPress={() => router.navigate({
            to: "/admin/users/$userId",
            params: { userId: item.id },
          })}
          style={{ padding: 16, borderBottomWidth: 1, borderColor: "#eee" }}
        >
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <View>
              <Text style={{ fontWeight: "600" }}>{item.name || item.email}</Text>
              <Text style={{ color: "#666", fontSize: 12 }}>{item.email}</Text>
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <StatusBadge status={item.status} />
              <Text style={{ color: "#888", fontSize: 11 }}>{item.role}</Text>
            </View>
          </View>
        </Pressable>
      )}
    />
  );
}
```

### Mobile Admin Route Guards

```typescript
// mobile/routes/_authenticated/_org/admin.tsx

export const Route = createFileRoute("/_authenticated/_org/admin")({
  beforeLoad: ({ context }) => {
    // Only admins and owners can access admin routes
    if (!context.canAny("users:list", "analytics:view", "admin:audit_log")) {
      throw redirect({ to: "/dashboard" });
    }
  },
  component: AdminLayout,
});
```

## 10.9 Sessions Management Screen

Users can view and revoke their own sessions from mobile.

```tsx
// mobile/screens/settings/SessionsScreen.tsx

import { FlatList, View, Text, Alert, Pressable } from "react-native";
import { useSessions, useRevokeSession } from "../../hooks/use-sessions";

export function SessionsScreen() {
  const { data: sessions } = useSessions();
  const { mutate: revokeSession } = useRevokeSession();

  const handleRevoke = (sessionId: string, deviceName: string) => {
    Alert.alert(
      "Sign Out Device",
      `Sign out "${deviceName}"? This will end the session immediately.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Sign Out",
          style: "destructive",
          onPress: () => revokeSession(sessionId),
        },
      ]
    );
  };

  return (
    <FlatList
      data={sessions}
      keyExtractor={(item) => item.session.id}
      ListHeaderComponent={
        <Text style={{ padding: 16, fontSize: 14, color: "#666" }}>
          Devices where you are currently signed in.
        </Text>
      }
      renderItem={({ item }) => (
        <View style={{ padding: 16, borderBottomWidth: 1, borderColor: "#eee" }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <View>
              <Text style={{ fontWeight: "600" }}>
                {item.device?.deviceName || "Unknown Device"}
              </Text>
              <Text style={{ color: "#666", fontSize: 12 }}>
                {item.device?.os} — {item.device?.deviceType}
              </Text>
              <Text style={{ color: "#888", fontSize: 11 }}>
                Last active: {formatRelativeTime(item.session.lastActiveAt)}
              </Text>
            </View>
            {item.session.id !== currentSessionId && (
              <Pressable
                onPress={() => handleRevoke(item.session.id, item.device?.deviceName || "device")}
              >
                <Text style={{ color: "#EF4444" }}>Sign Out</Text>
              </Pressable>
            )}
          </View>
        </View>
      )}
    />
  );
}
```

## 10.10 Consent Management Screen

```tsx
// mobile/screens/settings/PrivacyScreen.tsx

import { View, Text, Switch } from "react-native";
import { useConsents, useUpdateConsent } from "../../hooks/use-compliance";

export function PrivacyScreen() {
  const { data: consents } = useConsents();
  const { mutate: updateConsent } = useUpdateConsent();

  return (
    <View style={{ flex: 1, padding: 16 }}>
      <Text style={{ fontSize: 20, fontWeight: "bold", marginBottom: 16 }}>
        Privacy Settings
      </Text>

      {consents?.map((consent) => (
        <View
          key={consent.consentType}
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
            paddingVertical: 12,
            borderBottomWidth: 1,
            borderColor: "#eee",
          }}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: "600" }}>{consentLabels[consent.consentType]}</Text>
            <Text style={{ color: "#666", fontSize: 12 }}>
              {consentDescriptions[consent.consentType]}
            </Text>
          </View>
          <Switch
            value={consent.granted}
            disabled={consent.consentType === "essential"}
            onValueChange={(granted) =>
              updateConsent({ consentType: consent.consentType, granted })
            }
          />
        </View>
      ))}

      <Text style={{ marginTop: 24, color: "#888", fontSize: 12 }}>
        Essential data processing cannot be disabled as it is required for the service to function.
      </Text>
    </View>
  );
}

const consentLabels: Record<string, string> = {
  essential: "Essential",
  analytics: "Usage Analytics",
  marketing: "Marketing Communications",
  third_party: "Third-Party Data Sharing",
};

const consentDescriptions: Record<string, string> = {
  essential: "Required for account operation and security.",
  analytics: "Helps us improve the product by understanding how you use it.",
  marketing: "Receive product updates, tips, and newsletters.",
  third_party: "Allow data sharing with integrated services.",
};
```

## 10.11 Mobile File Structure (User Management Additions)

```
mobile/
├── lib/
│   ├── api-client.ts                   # ← Shared (unchanged)
│   ├── device-info.ts                  # Mobile device fingerprinting
│   ├── usage-buffer.ts                 # Client-side event buffering
│   └── api-client-interceptor.ts       # Status/quota error handling
│
├── hooks/
│   ├── use-usage.ts                    # ← Shared
│   ├── use-analytics.ts               # ← Shared
│   ├── use-quotas.ts                   # ← Shared
│   ├── use-compliance.ts              # ← Shared
│   ├── use-admin.ts                   # ← Shared
│   ├── use-feature-flags.ts           # ← Shared
│   ├── use-sessions.ts               # ← Shared
│   ├── use-session-heartbeat.ts       # Mobile (AppState-aware)
│   ├── use-push-notifications.ts      # Mobile-only
│   └── use-data-export-download.ts    # Mobile (expo-file-system + Share)
│
├── components/
│   ├── quota-warning-banner.tsx       # Native quota warning UI
│   └── status-badge.tsx               # User status indicator
│
├── screens/
│   ├── admin/
│   │   ├── UserListScreen.tsx
│   │   ├── UserDetailScreen.tsx
│   │   ├── AuditLogScreen.tsx
│   │   └── AnalyticsScreen.tsx
│   └── settings/
│       ├── SessionsScreen.tsx
│       ├── PrivacyScreen.tsx
│       └── DataExportScreen.tsx
│
└── routes/
    └── _authenticated/
        ├── account-suspended.tsx
        ├── account-deleted.tsx
        └── _org/
            ├── admin.tsx              # Admin guard layout
            ├── admin/
            │   ├── users.tsx
            │   ├── users.$userId.tsx
            │   ├── audit-log.tsx
            │   └── analytics.tsx
            └── settings/
                ├── sessions.tsx
                ├── privacy.tsx
                └── data-export.tsx
```

## 10.12 Summary: Mobile vs. Web Differences

| Subsystem | Web | Mobile | Shared |
|-----------|-----|--------|--------|
| **Device ID** | `localStorage` + `crypto.randomUUID()` | `expo-secure-store` + `crypto.randomUUID()` | ID format |
| **Device info** | `navigator.userAgent` parsing | `expo-device` + `expo-application` | API contract |
| **Session heartbeat** | `setInterval` (5 min) | `setInterval` + `AppState` listener | API endpoint |
| **Usage tracking** | Inline emit in `secureHandler` (server) | Client-side buffer → batch POST | Event schema |
| **Quota warnings** | shadcn Banner component | React Native View + Text | Hook (`useQuotaWarning`) |
| **Status screens** | Next.js pages | TanStack Router routes | API response codes |
| **Data export** | Browser download (`Content-Disposition`) | `expo-file-system` + `expo-sharing` | Export API |
| **Admin console** | shadcn DataTable, Dialogs | FlatList, Alert, Modal | All hooks + API |
| **Consent management** | shadcn Switch in settings page | React Native Switch | Hook + API |
| **Feature flags** | `useFeatureFlag()` | Same | Fully shared |

The mobile app is a **pure API consumer**. All authorization, quota enforcement, rate limiting, usage metering, and compliance logic runs server-side. The mobile-specific code is exclusively UI adaptation and platform-specific utilities (device info, file system, push notifications).
