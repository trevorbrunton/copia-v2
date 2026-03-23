# React Native Integration Guide

This guide explains how to consume the Mayfly backend from a React Native mobile app. The backend already supports mobile clients via Bearer token authentication — no server changes are required.

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [What You Reuse vs. What You Replace](#2-what-you-reuse-vs-what-you-replace)
3. [Prerequisites](#3-prerequisites)
4. [Project Setup](#4-project-setup)
5. [Auth Module — Mobile Variant](#5-auth-module--mobile-variant)
6. [API Client Configuration](#6-api-client-configuration)
7. [Reusing Hooks](#7-reusing-hooks)
8. [Navigation Guard](#8-navigation-guard)
9. [Token Refresh](#9-token-refresh)
10. [SSE Streaming (Chat)](#10-sse-streaming-chat)
11. [Complete Example: App Entry Point](#11-complete-example-app-entry-point)
12. [API Endpoint Reference](#12-api-endpoint-reference)
13. [Troubleshooting](#13-troubleshooting)

---

## 1. Architecture Overview

The web app uses HttpOnly cookies for session management. React Native has no browser cookie jar, so this path is bypassed entirely. Instead, the mobile app:

1. Authenticates directly with AWS Cognito via the Amplify SDK (same as web).
2. Stores the JWT in secure device storage (not cookies).
3. Sends the JWT as an `Authorization: Bearer <token>` header on every API request.

The server already checks for Bearer tokens **before** cookies in `src/auth/server.ts`:

```
getServerUserFromRequest(request)
  ├── 1. Authorization: Bearer <token>   ← mobile path (checked first)
  └── 2. idToken cookie                  ← web path (fallback)
```

All downstream logic (user provisioning, RLS, business logic) is identical for both auth methods. The mobile app talks to the same API routes as the web app.

```
┌──────────────────────────────┐
│       React Native App       │
│                              │
│  ┌────────────────────────┐  │
│  │  Amplify SDK           │  │  ← Same Cognito auth as web
│  │  (aws-amplify/auth)    │  │
│  └───────────┬────────────┘  │
│              │               │
│  ┌───────────▼────────────┐  │
│  │  Secure Storage        │  │  ← expo-secure-store or react-native-keychain
│  │  (idToken, refresh)    │  │     replaces HttpOnly cookie
│  └───────────┬────────────┘  │
│              │               │
│  ┌───────────▼────────────┐  │
│  │  apiFetch()            │  │  ← Same module from src/lib/api-client.ts
│  │  + Bearer header       │  │     configured with getHeaders()
│  └───────────┬────────────┘  │
│              │               │
│  ┌───────────▼────────────┐  │
│  │  TanStack Query Hooks  │  │  ← useUser, useProjects, useChat — unchanged
│  └───────────┬────────────┘  │
└──────────────┼───────────────┘
               │ HTTPS
               ▼
┌──────────────────────────────┐
│    Next.js API Routes        │
│                              │
│  requireAuthContext()        │
│    → Bearer token extracted  │
│    → JWT verified via JWKS   │
│    → getOrCreateUser()       │
│    → withTenantContext(RLS)  │
│    → route handler           │
└──────────────────────────────┘
```

## 2. What You Reuse vs. What You Replace

### Reuse directly (copy or symlink from the web project)

| Module | Path | Notes |
|--------|------|-------|
| API client | `src/lib/api-client.ts` | Core fetch wrapper; call `configureApiClient()` with baseUrl + getHeaders |
| Validation schemas | `src/auth/validation.ts` | Zod schemas for all auth forms |
| Error mapping | `src/auth/errors.ts` | `getAuthErrorMessage()` for user-facing Cognito errors |
| Type definitions | `src/auth/types.ts` | `AuthUser`, `AuthSession`, `AuthState`, `AuthConfig` |
| Data hooks | `src/hooks/use-user.ts` | Works unchanged via apiFetch |
| Data hooks | `src/hooks/use-projects.ts` | Works unchanged via apiFetch |
| Data hooks | `src/hooks/use-chat.ts` | Works unchanged (SSE via fetch ReadableStream) |

### Replace (web-specific, not applicable to mobile)

| Module | Path | Mobile Replacement |
|--------|------|--------------------|
| AuthProvider | `src/auth/provider.tsx` | Mobile-specific provider (see Section 5) |
| Auth config | `src/auth/config.ts` | Same Amplify config, different storage adapter |
| Middleware proxy | `src/auth/proxy.ts` | React Navigation auth guard (see Section 8) |
| Session endpoint | `app/api/auth/session/route.ts` | Not needed — no cookies on mobile |

### Not applicable on mobile

| Module | Path | Reason |
|--------|------|--------|
| Server utilities | `src/auth/server.ts` | Runs on Next.js server only |
| Auth context | `src/server/require-auth-context.ts` | Runs on Next.js server only |
| Tenant context | `src/lib/tenant.ts` | Runs on Next.js server only |
| User provisioning | `src/lib/auth.ts` | Runs on Next.js server only |

---

## 3. Prerequisites

```bash
# Expo project (recommended)
npx create-expo-app mayfly-mobile
cd mayfly-mobile

# Or bare React Native
npx @react-native-community/cli init MayflyMobile
```

### Required dependencies

```bash
# Auth
npm install aws-amplify @aws-amplify/react-native

# Secure storage (pick one)
npx expo install expo-secure-store          # Expo
# OR
npm install react-native-keychain           # Bare RN

# Data fetching
npm install @tanstack/react-query

# Validation
npm install zod

# Navigation
npm install @react-navigation/native @react-navigation/native-stack
npx expo install react-native-screens react-native-safe-area-context
```

---

## 4. Project Setup

### Environment configuration

Create an `env.ts` (React Native doesn't use `NEXT_PUBLIC_` env vars):

```typescript
// env.ts
export const ENV = {
  COGNITO_USER_POOL_ID: "ap-southeast-2_XXXXXXXXX",
  COGNITO_CLIENT_ID: "xxxxxxxxxxxxxxxxxxxxxxxxxx",
  COGNITO_REGION: "ap-southeast-2",
  API_BASE_URL: "https://your-api.example.com",  // Your deployed Next.js backend
};
```

### Amplify configuration

```typescript
// auth/config.ts
import { Amplify } from "aws-amplify";
import { ENV } from "../env";

export function configureAmplify() {
  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: ENV.COGNITO_USER_POOL_ID,
        userPoolClientId: ENV.COGNITO_CLIENT_ID,
      },
    },
  });
}
```

---

## 5. Auth Module — Mobile Variant

The web `AuthProvider` syncs tokens to an HttpOnly cookie via `/api/auth/session`. The mobile variant stores tokens in secure device storage instead.

### Token storage layer

```typescript
// auth/token-storage.ts
import * as SecureStore from "expo-secure-store";

const TOKEN_KEY = "mayfly_id_token";
const REFRESH_KEY = "mayfly_refresh_token";

export async function getStoredToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function storeToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function clearToken(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
  await SecureStore.deleteItemAsync(REFRESH_KEY);
}
```

### Mobile AuthProvider

This mirrors the web `AuthProvider` interface exactly — all consuming components use the same `useAuth()` hook shape. The only differences are:

1. `syncSessionCookie()` is replaced by `storeToken()`
2. `clearSessionCookie()` is replaced by `clearToken()`
3. No `/api/auth/session` HTTP calls

```typescript
// auth/provider.tsx
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  signIn as amplifySignIn,
  signUp as amplifySignUp,
  confirmSignUp as amplifyConfirmSignUp,
  resendSignUpCode as amplifyResendSignUpCode,
  signOut as amplifySignOut,
  resetPassword as amplifyResetPassword,
  confirmResetPassword as amplifyConfirmResetPassword,
  getCurrentUser,
  fetchAuthSession,
} from "aws-amplify/auth";
import { configureAmplify } from "./config";
import { AuthContext } from "./context";       // Reuse from web project
import type { AuthUser } from "./types";       // Reuse from web project
import { storeToken, clearToken } from "./token-storage";

configureAmplify();

const TOKEN_REFRESH_INTERVAL = 55 * 60 * 1000; // 55 minutes

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopTokenRefresh = useCallback(() => {
    if (refreshTimerRef.current) {
      clearInterval(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const cognitoUser = await getCurrentUser();
      const session = await fetchAuthSession({ forceRefresh: false });
      const idToken = session.tokens?.idToken;

      if (idToken) {
        // Store in secure storage instead of syncing to cookie
        await storeToken(idToken.toString());
      }

      setUser({
        userId: cognitoUser.userId,
        email: (idToken?.payload?.email as string) || "",
        name: idToken?.payload?.name as string | undefined,
      });
    } catch {
      await clearToken();
      setUser(null);
      stopTokenRefresh();
    } finally {
      setIsLoading(false);
    }
  }, [stopTokenRefresh]);

  const startTokenRefresh = useCallback(() => {
    stopTokenRefresh();
    refreshTimerRef.current = setInterval(async () => {
      try {
        const session = await fetchAuthSession({ forceRefresh: true });
        const idToken = session.tokens?.idToken;
        if (idToken) {
          await storeToken(idToken.toString());
        }
      } catch {
        stopTokenRefresh();
      }
    }, TOKEN_REFRESH_INTERVAL);
  }, [stopTokenRefresh]);

  useEffect(() => {
    refreshUser();
    return stopTokenRefresh;
  }, [refreshUser, stopTokenRefresh]);

  useEffect(() => {
    if (user) {
      startTokenRefresh();
    } else {
      stopTokenRefresh();
    }
  }, [user, startTokenRefresh, stopTokenRefresh]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const result = await amplifySignIn({ username: email, password });
      if (result.isSignedIn) {
        await refreshUser();
      } else if (result.nextStep.signInStep === "CONFIRM_SIGN_UP") {
        throw Object.assign(new Error("Your email has not been verified."), {
          name: "UserNotConfirmedException",
          needsVerification: true,
          email,
        });
      } else {
        throw new Error(
          `Sign-in requires additional step: ${result.nextStep.signInStep}`
        );
      }
    },
    [refreshUser]
  );

  const signUp = useCallback(
    async (email: string, password: string, name: string) => {
      const result = await amplifySignUp({
        username: email,
        password,
        options: {
          userAttributes: { email, name },
          autoSignIn: false,
        },
      });
      return {
        needsVerification: result.nextStep.signUpStep === "CONFIRM_SIGN_UP",
      };
    },
    []
  );

  const confirmSignUp = useCallback(
    async (email: string, code: string) => {
      await amplifyConfirmSignUp({ username: email, confirmationCode: code });
    },
    []
  );

  const resendCode = useCallback(async (email: string) => {
    await amplifyResendSignUpCode({ username: email });
  }, []);

  const signOut = useCallback(async () => {
    await amplifySignOut();
    await clearToken();    // Clear secure storage instead of cookie
    setUser(null);
  }, []);

  const forgotPassword = useCallback(async (email: string) => {
    await amplifyResetPassword({ username: email });
  }, []);

  const confirmResetPassword = useCallback(
    async (email: string, code: string, newPassword: string) => {
      await amplifyConfirmResetPassword({
        username: email,
        confirmationCode: code,
        newPassword,
      });
    },
    []
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        signIn,
        signUp,
        confirmSignUp,
        resendCode,
        signOut,
        forgotPassword,
        confirmResetPassword,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
```

---

## 6. API Client Configuration

The web app's `apiFetch()` from `src/lib/api-client.ts` works on mobile without changes. You just configure it differently at startup.

### Web (for comparison)

The web app doesn't need `getHeaders` because the browser sends the HttpOnly cookie automatically, and `baseUrl` is empty (same-origin requests).

### Mobile

```typescript
// app-init.ts
import { configureApiClient } from "./lib/api-client";  // Copy from web project
import { getStoredToken } from "./auth/token-storage";
import { ENV } from "./env";

export function initializeApiClient() {
  configureApiClient({
    baseUrl: ENV.API_BASE_URL,
    getHeaders: async () => {
      const token = await getStoredToken();
      if (token) {
        return { Authorization: `Bearer ${token}` };
      }
      return {};
    },
  });
}
```

The `getHeaders` function is called on every `apiFetch()` request. It reads the current token from secure storage and injects the Bearer header. This is the key difference — web relies on automatic cookie inclusion, mobile relies on explicit header injection.

### How it flows through the server

```
Mobile: apiFetch("/api/user")
  → fetch("https://your-api.example.com/api/user", {
      headers: { Authorization: "Bearer eyJhbG..." }
    })
  → requireAuthContext()
    → getServerUserFromRequest(request)
      → request.headers.get("authorization")  // "Bearer eyJhbG..."
      → verifyToken("eyJhbG...")              // jose JWKS verification
      → { userId: "abc-123", email: "user@example.com" }
    → getOrCreateUser("abc-123", "user@example.com")
    → withTenantContext(userId, handler)
    → handler returns Response
```

---

## 7. Reusing Hooks

All TanStack Query hooks work on mobile with zero modifications because they all go through `apiFetch()`:

```typescript
// These files can be copied directly from the web project:
//   src/hooks/use-user.ts
//   src/hooks/use-projects.ts
//   src/hooks/use-chat.ts
```

### Usage in a React Native screen

```tsx
// screens/ProjectsScreen.tsx
import { View, Text, FlatList, ActivityIndicator } from "react-native";
import { useProjects } from "../hooks/use-projects";

export function ProjectsScreen() {
  const { data, isLoading, error } = useProjects();

  if (isLoading) return <ActivityIndicator />;
  if (error) return <Text>Error: {error.message}</Text>;

  return (
    <FlatList
      data={data?.projects}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => (
        <View>
          <Text>{item.name}</Text>
          <Text>{item.description}</Text>
        </View>
      )}
    />
  );
}
```

### Mutations work identically

```tsx
import { useCreateProject } from "../hooks/use-projects";

function CreateProjectButton() {
  const { mutate, isPending } = useCreateProject();

  return (
    <Button
      title="New Project"
      disabled={isPending}
      onPress={() => mutate({ name: "My Project", description: "A new project" })}
    />
  );
}
```

The optimistic updates built into `useCreateProject`, `useUpdateProject`, and `useDeleteProject` all work identically on mobile because they operate on the TanStack Query cache, not the DOM.

---

## 8. Navigation Guard

The web app uses Next.js middleware (`proxy.ts`) to redirect unauthenticated users. On mobile, use React Navigation's conditional rendering pattern instead.

```tsx
// navigation/RootNavigator.tsx
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useAuth } from "../auth/context";
import { ActivityIndicator, View } from "react-native";

// Auth screens (public)
import { SignInScreen } from "../screens/SignInScreen";
import { SignUpScreen } from "../screens/SignUpScreen";
import { VerifyScreen } from "../screens/VerifyScreen";
import { ForgotPasswordScreen } from "../screens/ForgotPasswordScreen";
import { ResetPasswordScreen } from "../screens/ResetPasswordScreen";

// App screens (protected)
import { DashboardScreen } from "../screens/DashboardScreen";
import { ProjectsScreen } from "../screens/ProjectsScreen";
import { ChatScreen } from "../screens/ChatScreen";
import { SettingsScreen } from "../screens/SettingsScreen";

const Stack = createNativeStackNavigator();

export function RootNavigator() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {isAuthenticated ? (
          // Protected screens — only rendered when authenticated
          <>
            <Stack.Screen name="Dashboard" component={DashboardScreen} />
            <Stack.Screen name="Projects" component={ProjectsScreen} />
            <Stack.Screen name="Chat" component={ChatScreen} />
            <Stack.Screen name="Settings" component={SettingsScreen} />
          </>
        ) : (
          // Auth screens — only rendered when unauthenticated
          <>
            <Stack.Screen name="SignIn" component={SignInScreen} />
            <Stack.Screen name="SignUp" component={SignUpScreen} />
            <Stack.Screen name="Verify" component={VerifyScreen} />
            <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
            <Stack.Screen name="ResetPassword" component={ResetPasswordScreen} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
```

This achieves the same effect as the web middleware:
- Unauthenticated users can only see auth screens
- Authenticated users can only see app screens
- Transitions happen automatically when `isAuthenticated` changes (after sign-in/sign-out)

---

## 9. Token Refresh

The mobile `AuthProvider` handles token refresh identically to the web version — a 55-minute interval timer that calls `fetchAuthSession({ forceRefresh: true })` and stores the refreshed token.

### How the refresh cycle works

```
T=0min    signIn() → Cognito issues idToken (60min) + refreshToken (30 days)
          → storeToken(idToken) to SecureStore
          → startTokenRefresh() starts 55-min interval

T=55min   Interval fires:
          → fetchAuthSession({ forceRefresh: true })
          → Amplify uses refreshToken → Cognito returns new idToken
          → storeToken(newIdToken)
          → getHeaders() in apiFetch will now return the new token

T=110min  Next refresh cycle (same as above)

T=30days  Refresh token expires:
          → fetchAuthSession() fails
          → stopTokenRefresh()
          → clearToken()
          → setUser(null)
          → Navigator switches to auth screens automatically
```

### App backgrounding

React Native timers don't fire reliably when the app is backgrounded. Handle this by refreshing on app foreground:

```typescript
// hooks/use-app-foreground-refresh.ts
import { useEffect } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { fetchAuthSession } from "aws-amplify/auth";
import { storeToken } from "../auth/token-storage";

export function useAppForegroundRefresh() {
  useEffect(() => {
    const handleAppStateChange = async (nextState: AppStateStatus) => {
      if (nextState === "active") {
        try {
          // Force refresh when app comes to foreground
          const session = await fetchAuthSession({ forceRefresh: true });
          const idToken = session.tokens?.idToken;
          if (idToken) {
            await storeToken(idToken.toString());
          }
        } catch {
          // Token refresh failed — user will be signed out on next API call
        }
      }
    };

    const subscription = AppState.addEventListener("change", handleAppStateChange);
    return () => subscription.remove();
  }, []);
}
```

Use this hook in your root component:

```tsx
export function App() {
  useAppForegroundRefresh();
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClient}>
        <RootNavigator />
      </QueryClientProvider>
    </AuthProvider>
  );
}
```

---

## 10. SSE Streaming (Chat)

The `useStreamChat` hook from `src/hooks/use-chat.ts` uses `fetch` with `ReadableStream` to consume SSE events. This works on React Native with some considerations.

### React Native ≥ 0.72 (Hermes)

Hermes supports `ReadableStream` and `TextDecoder` — the hook works as-is. Copy it directly.

### React Native < 0.72 or missing ReadableStream

Install a polyfill:

```bash
npm install react-native-polyfill-globals text-encoding web-streams-polyfill
```

```typescript
// polyfills.ts (import at app entry before anything else)
import { polyfill as polyfillEncoding } from "react-native-polyfill-globals/src/encoding";
import { polyfill as polyfillReadableStream } from "react-native-polyfill-globals/src/readable-stream";

polyfillEncoding();
polyfillReadableStream();
```

### Alternative: EventSource approach

If `ReadableStream` is unreliable on your target platform, you can consume the SSE endpoint with a dedicated EventSource library:

```bash
npm install react-native-sse
```

```typescript
// hooks/use-stream-chat-native.ts
import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getStoredToken } from "../auth/token-storage";
import { ENV } from "../env";
import EventSource from "react-native-sse";

export function useStreamChat() {
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamedText, setStreamedText] = useState("");
  const esRef = useRef<EventSource | null>(null);
  const queryClient = useQueryClient();

  const sendMessage = useCallback(
    async (
      conversationId: string,
      message: string,
      history: { role: string; content: string }[]
    ): Promise<string> => {
      setIsStreaming(true);
      setStreamedText("");

      const token = await getStoredToken();

      return new Promise((resolve, reject) => {
        let fullText = "";

        const es = new EventSource(`${ENV.API_BASE_URL}/api/chat/stream`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            conversationId,
            message,
            conversationHistory: history,
          }),
        });

        esRef.current = es;

        es.addEventListener("message", (event: { data: string }) => {
          if (event.data === "[DONE]") {
            es.close();
            setIsStreaming(false);
            queryClient.invalidateQueries({ queryKey: ["messages", conversationId] });
            queryClient.invalidateQueries({ queryKey: ["conversations"] });
            resolve(fullText);
            return;
          }

          try {
            const parsed = JSON.parse(event.data);
            if (parsed.type === "chunk" && parsed.text) {
              fullText += parsed.text;
              setStreamedText(fullText);
            }
          } catch {
            // Skip malformed events
          }
        });

        es.addEventListener("error", (error: unknown) => {
          es.close();
          setIsStreaming(false);
          reject(error);
        });
      });
    },
    [queryClient]
  );

  const cancelStream = useCallback(() => {
    esRef.current?.close();
    setIsStreaming(false);
  }, []);

  return { sendMessage, cancelStream, isStreaming, streamedText };
}
```

---

## 11. Complete Example: App Entry Point

```tsx
// App.tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "./auth/provider";
import { RootNavigator } from "./navigation/RootNavigator";
import { useAppForegroundRefresh } from "./hooks/use-app-foreground-refresh";
import { initializeApiClient } from "./app-init";

// Initialize API client once at module level
initializeApiClient();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      retry: 2,
    },
  },
});

function AppInner() {
  useAppForegroundRefresh();

  return (
    <QueryClientProvider client={queryClient}>
      <RootNavigator />
    </QueryClientProvider>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppInner />
    </AuthProvider>
  );
}
```

### File structure for the mobile app

```
mayfly-mobile/
├── App.tsx                          # Entry point
├── app-init.ts                      # configureApiClient()
├── env.ts                           # Environment variables
│
├── auth/                            # Mobile auth module
│   ├── config.ts                    # Amplify configuration
│   ├── context.ts                   # ← COPIED from web (no changes)
│   ├── errors.ts                    # ← COPIED from web (no changes)
│   ├── provider.tsx                 # Mobile variant (SecureStore instead of cookies)
│   ├── token-storage.ts             # SecureStore read/write/clear
│   ├── types.ts                     # ← COPIED from web (no changes)
│   └── validation.ts                # ← COPIED from web (no changes)
│
├── lib/
│   └── api-client.ts                # ← COPIED from web (no changes)
│
├── hooks/
│   ├── use-user.ts                  # ← COPIED from web (no changes)
│   ├── use-projects.ts              # ← COPIED from web (no changes)
│   ├── use-chat.ts                  # ← COPIED from web (no changes)*
│   └── use-app-foreground-refresh.ts  # Mobile-only: refresh on foreground
│
├── navigation/
│   └── RootNavigator.tsx            # Auth-gated navigation
│
└── screens/
    ├── SignInScreen.tsx
    ├── SignUpScreen.tsx
    ├── VerifyScreen.tsx
    ├── ForgotPasswordScreen.tsx
    ├── ResetPasswordScreen.tsx
    ├── DashboardScreen.tsx
    ├── ProjectsScreen.tsx
    ├── ChatScreen.tsx
    └── SettingsScreen.tsx

* use-chat.ts works as-is on Hermes ≥ 0.72. For older engines, use
  use-stream-chat-native.ts with react-native-sse.
```

---

## 12. API Endpoint Reference

All endpoints accept `Authorization: Bearer <idToken>` for mobile authentication.

### Auth (no token required)

| Method | Endpoint | Body | Purpose |
|--------|----------|------|---------|
| — | — | — | Mobile does not need `/api/auth/session`. Auth goes directly via Amplify SDK → Cognito. |

### User

| Method | Endpoint | Body | Response |
|--------|----------|------|----------|
| GET | `/api/user` | — | `{ id, email, name, cognitoId, createdAt, updatedAt }` |
| PATCH | `/api/user` | `{ name?: string }` | Updated user object |

### Projects

| Method | Endpoint | Body | Response |
|--------|----------|------|----------|
| GET | `/api/projects?search=&status=` | — | `{ projects: Project[], total: number }` |
| POST | `/api/projects` | `{ name, description? }` | Created project |
| GET | `/api/projects/:id` | — | Single project |
| PATCH | `/api/projects/:id` | `{ name?, description?, status? }` | Updated project |
| DELETE | `/api/projects/:id` | — | 204 No Content |

### Chat

| Method | Endpoint | Body | Response |
|--------|----------|------|----------|
| GET | `/api/chat/conversations` | — | `Conversation[]` |
| POST | `/api/chat/conversations` | `{ title? }` | Created conversation |
| GET | `/api/chat/conversations/:id` | — | Single conversation |
| DELETE | `/api/chat/conversations/:id` | — | 204 No Content |
| GET | `/api/chat/conversations/:id/messages` | — | `Message[]` |
| POST | `/api/chat/stream` | `{ conversationId, message, conversationHistory }` | SSE stream |

### SSE Stream Format

The `/api/chat/stream` endpoint returns Server-Sent Events:

```
data: {"type":"chunk","text":"Hello"}
data: {"type":"chunk","text":" world"}
data: [DONE]
```

---

## 13. Troubleshooting

### "Unauthorized" on every API call

1. **Check baseUrl** — `configureApiClient({ baseUrl })` must point to the deployed Next.js server, not `localhost:3000` (unless using a tunnel).
2. **Check token storage** — Call `getStoredToken()` and verify it returns a non-null JWT string.
3. **Check token validity** — Decode the JWT at jwt.io and verify `exp` is in the future and `iss` matches your Cognito User Pool.
4. **Check CORS** — The Next.js server may need CORS headers if the mobile app uses a different origin. Add a `next.config.ts` headers configuration or use a middleware.

### CORS configuration (if needed)

If the mobile app's requests are blocked by CORS (common with Expo web or proxied dev setups), add headers to the Next.js config:

```typescript
// next.config.ts
const nextConfig = {
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Access-Control-Allow-Methods", value: "GET,POST,PATCH,DELETE,OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "Content-Type,Authorization" },
        ],
      },
    ];
  },
};
```

Note: Native mobile HTTP requests (not from a webview) typically bypass CORS. This is mainly needed if you test via Expo Web or a webview-based approach.

### Token not refreshing in background

React Native `setInterval` is unreliable when the app is backgrounded. Use the `useAppForegroundRefresh` hook (Section 9) to refresh on app foregrounding. The 55-minute timer handles foreground refresh; the AppState listener handles the case where the app was backgrounded for longer than 60 minutes.

### Amplify storage warnings

By default, Amplify v6 uses `localStorage` for token persistence. On React Native, you should configure a custom storage adapter:

```typescript
// auth/config.ts
import { Amplify } from "aws-amplify";
import * as SecureStore from "expo-secure-store";
import { ENV } from "../env";

const secureStorage = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

export function configureAmplify() {
  Amplify.configure(
    {
      Auth: {
        Cognito: {
          userPoolId: ENV.COGNITO_USER_POOL_ID,
          userPoolClientId: ENV.COGNITO_CLIENT_ID,
        },
      },
    },
    {
      ssr: false,
      storage: secureStorage,
    }
  );
}
```

This ensures Amplify stores its internal tokens (including the refresh token) in secure device storage rather than unprotected AsyncStorage.

### SSE streaming not working

1. Verify your React Native version supports `ReadableStream` (Hermes ≥ 0.72).
2. If not, use the `react-native-sse` approach from Section 10.
3. Ensure the Bearer token is being sent — SSE connections don't send cookies, so Bearer auth is the only option.
