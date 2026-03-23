# api-client.ts — Line-by-Line Explanation

**File:** `src/lib/api-client.ts`

This is the app's HTTP wrapper. Every API call from the browser goes through `apiFetch()` instead of bare `fetch()`. It adds two features on top of the standard Fetch API: configurable base URL + headers, and automatic detection of suspended/deleted accounts.

---

## Lines 1–6: Type Definitions

```typescript
type HeadersFn = () => Promise<Record<string, string>> | Record<string, string>;
```
Defines a type for a function that returns HTTP headers. It can return them synchronously (a plain object) or asynchronously (a Promise). This is used for injecting auth tokens — for example, a mobile app might need to `await` reading a token from secure storage, while a web app might have headers available immediately.

```typescript
interface ApiClientConfig {
  baseUrl: string;
  getHeaders?: HeadersFn;
}
```
The configuration shape for the API client:
- `baseUrl` — A prefix added to all relative URLs. On web this is `""` (empty string, since the API is on the same origin). On mobile, this would be `"https://yourapp.com"` so relative paths like `/api/projects` become full URLs.
- `getHeaders` — An optional function that provides extra headers for every request. Used on mobile to inject a Bearer token. On web this is not set, because the browser sends the Supabase session cookie automatically.

## Lines 8–10: Default Config

```typescript
let config: ApiClientConfig = {
  baseUrl: "",
};
```
Creates a module-level variable holding the current configuration. Starts with an empty `baseUrl` (which means "same origin" — relative URLs like `/api/projects` work as-is on the web). `getHeaders` is `undefined` by default, meaning no extra headers are injected.

This is a **module singleton** — there's one `config` object shared by all code that imports from this file.

## Lines 12–14: Configuration Function

```typescript
export function configureApiClient(newConfig: Partial<ApiClientConfig>) {
  config = { ...config, ...newConfig };
}
```
Lets you change the config at runtime. `Partial<ApiClientConfig>` means you can pass just the fields you want to change — you don't have to provide everything.

The spread operator `{ ...config, ...newConfig }` creates a new object with all existing config values, then overwrites any values provided in `newConfig`.

**When this is called:** On mobile, during app startup, to set the `baseUrl` and `getHeaders`. On web, this is typically never called — the defaults work.

## Lines 16–19: The `apiFetch` Function Signature

```typescript
export async function apiFetch(
  input: string | URL | Request,
  init?: RequestInit
): Promise<Response> {
```
This is the main export — the function all hooks call instead of `fetch()`.

- `input` — The URL to fetch. Can be a string (`"/api/projects"`), a `URL` object, or a `Request` object. Same types as the standard `fetch()`.
- `init` — Optional request configuration (method, headers, body, etc.). Same as standard `fetch()`.
- Returns a `Promise<Response>` — same return type as `fetch()`.

It's a **drop-in replacement** for `fetch()` with two extra behaviours bolted on.

## Lines 20–22: Base URL Prepending

```typescript
  if (typeof input === "string" && input.startsWith("/")) {
    input = `${config.baseUrl}${input}`;
  }
```
If the URL is a string starting with `/` (a relative path like `/api/projects`), prepend the configured `baseUrl`.

- **On web:** `baseUrl` is `""`, so `/api/projects` stays as `/api/projects`. The browser resolves this relative to the current origin.
- **On mobile:** `baseUrl` might be `"https://myapp.com"`, so `/api/projects` becomes `"https://myapp.com/api/projects"`.

URLs that don't start with `/` (full URLs) or non-string inputs (URL/Request objects) are left unchanged.

## Lines 24–33: Header Injection

```typescript
  if (config.getHeaders) {
    const extraHeaders = await config.getHeaders();
    const headers = new Headers(init?.headers);
    for (const [key, value] of Object.entries(extraHeaders)) {
      if (!headers.has(key)) {
        headers.set(key, value);
      }
    }
    init = { ...init, headers };
  }
```
If a `getHeaders` function was configured, call it and merge the returned headers into the request.

Step by step:
1. `await config.getHeaders()` — Call the function. If it returns a Promise (async token retrieval), wait for it.
2. `new Headers(init?.headers)` — Create a `Headers` object from any headers the caller already provided. If `init` is undefined or has no headers, this creates an empty `Headers` object.
3. The `for` loop iterates over the extra headers. `if (!headers.has(key))` ensures that caller-provided headers take precedence — if the caller already set `Content-Type`, the injected one won't overwrite it.
4. `init = { ...init, headers }` — Replace the `init` object with a new one that includes the merged headers.

**Typical use case:** On mobile, `getHeaders` returns `{ Authorization: "Bearer <token>" }`. This gets added to every request without each hook needing to know about auth.

## Line 35: The Actual Fetch

```typescript
  const response = await fetch(input, init);
```
Calls the standard browser `fetch()` with the (possibly modified) URL and init. This is where the HTTP request actually happens.

On the web, the browser automatically includes cookies (including the Supabase session cookie set by `@supabase/ssr`). No explicit `credentials` option is needed because same-origin requests include cookies by default.

## Lines 37–53: Account Status Interception

```typescript
  if (
    typeof window !== "undefined" &&
    response.status === 403
  ) {
    const cloned = response.clone();
    const body = await cloned.json().catch(() => null);
    if (
      body?.code === "ACCOUNT_SUSPENDED" ||
      body?.code === "ACCOUNT_DELETED"
    ) {
      window.dispatchEvent(
        new CustomEvent("account-status-error", {
          detail: { code: body.code, reason: body.reason },
        })
      );
    }
  }
```
This is the **account status detection** logic. It runs after every response.

Step by step:
1. `typeof window !== "undefined"` — Only run in the browser (not during server-side rendering or in Node.js). This guard prevents crashes when `apiFetch` is called on the server.
2. `response.status === 403` — Only inspect Forbidden responses. Other status codes pass through untouched.
3. `response.clone()` — Creates a copy of the response. This is necessary because a Response body can only be read once. Cloning lets us read the body here for inspection while still returning the original response to the caller so they can also read it.
4. `await cloned.json().catch(() => null)` — Try to parse the cloned response body as JSON. If it fails (e.g., the body isn't JSON), silently return `null` instead of throwing.
5. `body?.code === "ACCOUNT_SUSPENDED" || body?.code === "ACCOUNT_DELETED"` — Check if the 403 is specifically because the user's account was suspended or deleted (as opposed to a regular permission denied).
6. `window.dispatchEvent(new CustomEvent(...))` — Fire a custom DOM event that the `AccountStatusHandler` component (in `components/account-status-handler.tsx`) is listening for. That component shows a full-screen overlay forcing the user to sign out.

**Why a custom event?** Because this code runs deep in the data-fetching layer — it has no access to React state or navigation. DOM events are a clean way to communicate across boundaries. The `AccountStatusHandler` component adds a `window.addEventListener("account-status-error", ...)` listener and responds by showing the overlay.

## Line 55: Return the Response

```typescript
  return response;
```
Returns the original (unmodified) response to the caller. The caller (a TanStack Query hook) then checks `response.ok`, parses the JSON, handles errors, etc.

The account status interception above was **observation only** — it didn't modify or consume the response. The caller gets the exact same Response object that `fetch()` returned.

---

## How It Fits in the Architecture

```
React Component
  └── useCreateProject()           ← TanStack Query hook
        └── apiFetch("/api/projects", { method: "POST", body })
              │
              ├── Prepend baseUrl (mobile only)
              ├── Inject auth headers (mobile only)
              ├── fetch() ──────────────────────► API Route
              │
              ├── Check for 403 account status
              │   └── Dispatch "account-status-error" event
              │       └── AccountStatusHandler shows overlay
              │
              └── Return Response to hook
```

**Key design choice:** `apiFetch` is intentionally thin. It doesn't throw on non-2xx responses — that's the caller's job. It doesn't parse JSON — that's the caller's job. It only adds the two cross-cutting concerns (URL/header config, account status detection) that every API call needs.
