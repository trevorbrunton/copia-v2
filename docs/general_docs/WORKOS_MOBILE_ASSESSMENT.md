# WorkOS Mobile Support Assessment

## Executive Summary

**WorkOS does not currently provide a good out-of-the-box solution for mobile clients.** There are no React Native, iOS (Swift), or Android (Kotlin) SDKs. Mobile integration requires manual OAuth PKCE implementation and custom token management — work that mature mobile SDKs (like AWS Amplify for Cognito) handle automatically.

**Recommendation:** Keep Cognito for mobile authentication. If adopting WorkOS, use a hybrid approach where mobile clients authenticate via Cognito while web clients use WorkOS AuthKit.

---

## 1. Available WorkOS SDKs

WorkOS provides server-side and web framework SDKs only:

| SDK | Platform | Mobile-Ready? |
|-----|----------|---------------|
| Node.js | Server | N/A |
| Ruby | Server | N/A |
| Python | Server | N/A |
| Go | Server | N/A |
| PHP | Server | N/A |
| Java | Server | N/A |
| .NET | Server | N/A |
| Next.js | Web framework | No |
| Remix | Web framework | No |
| React Native | Mobile | **Does not exist** |
| iOS (Swift) | Mobile | **Does not exist** |
| Android (Kotlin) | Mobile | **Does not exist** |

WorkOS documentation notes "(more framework support coming soon)" but provides no timeline for mobile SDKs.

---

## 2. What's Missing for Mobile

| Gap | Impact |
|-----|--------|
| No React Native SDK | Must implement OAuth PKCE flow manually |
| No iOS/Swift SDK | No native token management, no Keychain helpers |
| No Android/Kotlin SDK | No native token management, no EncryptedSharedPreferences helpers |
| No PKCE helpers | Must build code_verifier/code_challenge generation yourself |
| No native token storage | Must handle secure storage (SecureStore, Keychain, Android Keystore) yourself |
| No mobile session management | No device fingerprinting, no mobile-optimized refresh flows |
| AuthKit is web-focused | Redirect-based OAuth flow assumes a browser environment |

---

## 3. What You'd Have to Build

### 3.1 React Native

```typescript
// OAuth PKCE flow via expo-auth-session or react-native-app-auth
import * as AuthSession from "expo-auth-session";
import * as SecureStore from "expo-secure-store";

// 1. Generate PKCE code_verifier + code_challenge
// 2. Open WorkOS AuthKit in system WebView
// 3. Handle redirect back to app with authorization code
// 4. Exchange code for tokens via your backend
// 5. Store tokens in SecureStore
// 6. Implement token refresh logic
// 7. Implement session heartbeats
// 8. Implement device registration
```

**Estimated effort:** 2-3 weeks for a production-ready implementation.

### 3.2 Swift (iOS)

```swift
// OAuth PKCE flow via ASWebAuthenticationSession
import AuthenticationServices

// 1. Generate PKCE code_verifier + code_challenge
// 2. Present ASWebAuthenticationSession with WorkOS AuthKit URL
// 3. Handle callback URL with authorization code
// 4. Exchange code for tokens via backend
// 5. Store tokens in Keychain via Security framework
// 6. Implement token refresh with URLSession
// 7. Implement background session management
// 8. Implement biometric auth gate (optional)
```

**Estimated effort:** 2-3 weeks for a production-ready implementation.

### 3.3 Kotlin (Android)

```kotlin
// OAuth PKCE flow via Chrome Custom Tabs
import androidx.browser.customtabs.CustomTabsIntent
import androidx.security.crypto.EncryptedSharedPreferences

// 1. Generate PKCE code_verifier + code_challenge
// 2. Launch Chrome Custom Tab with WorkOS AuthKit URL
// 3. Handle deep link redirect with authorization code
// 4. Exchange code for tokens via backend
// 5. Store tokens in EncryptedSharedPreferences
// 6. Implement token refresh with Retrofit/Ktor
// 7. Implement WorkManager for background token refresh
// 8. Implement BiometricPrompt gate (optional)
```

**Estimated effort:** 2-3 weeks for a production-ready implementation.

---

## 4. Comparison to Current Architecture (Cognito)

| Feature | Our System (Cognito) | WorkOS |
|---------|---------------------|--------|
| React Native SDK | `aws-amplify` with full RN support | None |
| iOS SDK | `AWSMobileClient` (Swift) | None |
| Android SDK | `AWSMobileClient` (Kotlin) | None |
| Token storage | SDK handles SecureStore/Keychain | Manual |
| Token refresh | SDK auto-refreshes (55-min cycle) | Manual PKCE refresh |
| Biometric auth | Amplify supports it natively | Not available |
| Offline token caching | Built into SDK | Manual |
| Device tracking | Cognito device tracking built-in | Manual |
| MFA on mobile | SDK provides native UI flows | WebView-only |
| Push notification auth | Cognito custom auth challenge | Not available |
| Social login (mobile) | Amplify handles OAuth redirects | Manual WebView |

**Cognito wins decisively on mobile.** Every feature that WorkOS would require you to build manually is already handled by Cognito's mobile SDKs.

---

## 5. The REST API Escape Hatch

WorkOS does expose a comprehensive REST API that is callable from any HTTP client. In theory, you could build a mobile client that:

1. Uses the REST API directly for user management operations
2. Implements OAuth PKCE manually for authentication
3. Manages tokens and sessions with custom code

However, this approach:
- Requires significant mobile engineering effort
- Loses the security benefits of battle-tested SDKs (secure token storage, certificate pinning, etc.)
- Creates maintenance burden as WorkOS evolves its API
- Provides no advantage over using Cognito, which already has mobile SDKs

---

## 6. Hybrid Architecture Recommendation

The optimal approach if adopting WorkOS is a **dual-identity hybrid**:

```
┌─────────────────────────────────────────────────┐
│                  API Layer                       │
│         secureHandler verifies JWTs              │
│       from EITHER Cognito OR WorkOS              │
│                                                  │
│  ┌──────────────┐        ┌──────────────────┐   │
│  │ Cognito JWT  │        │  WorkOS JWT      │   │
│  │ (mobile)     │        │  (web)           │   │
│  └──────┬───────┘        └────────┬─────────┘   │
│         │                         │              │
└─────────┼─────────────────────────┼──────────────┘
          │                         │
   ┌──────┴──────┐          ┌──────┴──────┐
   │ Mobile Apps │          │  Web App    │
   │ RN / Swift  │          │  Next.js    │
   │ / Kotlin    │          │             │
   │             │          │             │
   │ Cognito SDK │          │ WorkOS      │
   │ (native)    │          │ AuthKit     │
   └─────────────┘          └─────────────┘
```

### How It Works

1. **Mobile clients** authenticate via Cognito using native SDKs (Amplify for RN, AWSMobileClient for Swift/Kotlin)
2. **Web clients** authenticate via WorkOS AuthKit (redirect-based flow, enterprise SSO)
3. **API layer** accepts JWTs from either issuer — `secureHandler` checks the `iss` claim and validates against the appropriate JWKS endpoint
4. **User identity** is unified via the `getOrCreateUser` pattern — both Cognito and WorkOS tokens map to the same internal user record

### Benefits

- Mobile gets mature, battle-tested SDKs with native token management
- Web gets WorkOS enterprise features (SSO, Directory Sync, Admin Portal)
- API layer remains identity-provider agnostic
- No mobile regression when adopting WorkOS for web

### secureHandler Modification

```typescript
// src/auth/server.ts — dual issuer verification

async function verifyToken(token: string): Promise<AuthUser> {
  const header = decodeProtectedHeader(token);
  const payload = decodeJwt(token);

  if (payload.iss?.includes("cognito")) {
    // Verify against Cognito JWKS (existing logic)
    return verifyCognitoToken(token);
  } else if (payload.iss?.includes("workos")) {
    // Verify against WorkOS JWKS
    return verifyWorkOSToken(token);
  }

  throw new Error("Unknown token issuer");
}
```

---

## 7. Summary

| Question | Answer |
|----------|--------|
| Does WorkOS support React Native? | **No** — no SDK, manual OAuth PKCE required |
| Does WorkOS support Swift (iOS)? | **No** — no SDK, manual ASWebAuthenticationSession required |
| Does WorkOS support Kotlin (Android)? | **No** — no SDK, manual Chrome Custom Tabs required |
| Is WorkOS viable for mobile? | **Technically yes** via REST API, but impractical |
| Should we use WorkOS for mobile? | **No** — keep Cognito for mobile, use WorkOS for web only |
| Best architecture? | **Hybrid** — Cognito mobile + WorkOS web + dual JWT verification |
