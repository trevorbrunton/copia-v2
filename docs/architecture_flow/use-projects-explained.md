# use-projects.ts — Line-by-Line Explanation

**File:** `src/hooks/use-projects.ts`

This is the **client-side data layer** for projects. It contains TanStack Query hooks that React components call to list, create, update, and delete projects. Every hook uses `apiFetch` (never bare `fetch`) and includes optimistic updates for mutations.

This document focuses on `useCreateProject` since that's our traced example, but explains all hooks for completeness.

---

## Line 1: Client Directive

```typescript
"use client";
```
Next.js directive that marks this file as client-side only. TanStack Query hooks use React state and effects, which only work in client components. Without this directive, Next.js would try to run this code on the server and fail.

## Lines 3–4: Imports

```typescript
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
```
Three hooks from TanStack Query:

- **`useQuery`** — For reading data. Handles caching, refetching, loading states, and stale-while-revalidate. Used by `useProjects` and `useProject`.
- **`useMutation`** — For writing data. Handles optimistic updates, error rollback, and cache invalidation. Used by `useCreateProject`, `useUpdateProject`, `useDeleteProject`.
- **`useQueryClient`** — Access the query cache directly. Mutations need this to read/write cached data for optimistic updates.

```typescript
import { apiFetch } from "@/src/lib/api-client";
```
The app's HTTP wrapper (explained in `api-client-explained.md`). Adds base URL handling, header injection, and account status detection on top of `fetch`.

## Lines 6–19: Type Definitions

```typescript
interface Project {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}
```
The shape of a project as returned by the API. Matches the database row from `project-service.ts`, but with dates as strings (JSON serialisation converts `Date` objects to ISO strings).

**`description: string | null`** — Nullable because description is optional when creating a project.

**`status: string`** — One of `"active"`, `"draft"`, `"completed"`, `"archived"`. Typed as `string` rather than a union because the client doesn't need to enforce the enum — the server validates it.

```typescript
interface ProjectsResponse {
  projects: Project[];
  total: number;
}
```
The shape returned by `GET /api/projects`. Contains the list of projects and a total count (for pagination).

---

## Lines 21–35: `useProjects` — List Projects

```typescript
export function useProjects(search?: string, status?: string) {
```
Hook for fetching the project list. Accepts optional filters. Components call it like:
```tsx
const { data, isLoading, error } = useProjects(searchTerm, statusFilter);
```

```typescript
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (status) params.set("status", status);
  const qs = params.toString();
```
Build the query string from the optional filters. `URLSearchParams` handles encoding special characters. If both are provided, `qs` might be `"search=foo&status=active"`. If neither, `qs` is `""`.

```typescript
  return useQuery<ProjectsResponse>({
    queryKey: ["projects", search, status],
```
**`queryKey`** — The cache key. TanStack Query uses this to:
1. **Cache results** — The same key returns cached data instead of refetching.
2. **Auto-refetch** — When `search` or `status` changes, the key changes, triggering a new fetch.
3. **Invalidation** — When a mutation calls `invalidateQueries({ queryKey: ["projects"] })`, all queries whose key starts with `["projects"]` are refetched.

```typescript
    queryFn: async () => {
      const res = await apiFetch(`/api/projects${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw new Error("Failed to fetch projects");
      return res.json();
    },
  });
}
```
**`queryFn`** — The function that fetches data. TanStack Query calls it automatically on mount, on window focus, and when the query is invalidated.

**`if (!res.ok) throw new Error(...)`** — TanStack Query expects the query function to throw on errors. This sets `error` on the returned object and puts the query in an error state.

**`return res.json()`** — Parse the JSON response. The return value becomes `data` on the hook's return object.

---

## Lines 37–47: `useProject` — Get Single Project

```typescript
export function useProject(id: string) {
  return useQuery<Project>({
    queryKey: ["project", id],
    queryFn: async () => {
      const res = await apiFetch(`/api/projects/${id}`);
      if (!res.ok) throw new Error("Failed to fetch project");
      return res.json();
    },
    enabled: !!id,
  });
}
```
Fetches a single project by ID. Same pattern as `useProjects` with two differences:

**`queryKey: ["project", id]`** — Uses `"project"` (singular), not `"projects"`. This means invalidating `["projects"]` (the list) doesn't invalidate individual project queries — they have separate cache entries.

**`enabled: !!id`** — Only runs the query if `id` is truthy. `!!id` converts the string to a boolean (`""` → `false`, `"abc-123"` → `true`). This prevents the hook from firing a request with an empty ID during initial render before the ID is available.

---

## Lines 49–94: `useCreateProject` — Create Project (with Optimistic Update)

This is the hook used in our create project trace. It's the most complex hook because it implements the full optimistic update pattern.

```typescript
export function useCreateProject() {
  const queryClient = useQueryClient();
```
**`useQueryClient()`** — Gets access to the TanStack Query cache. Needed to read and modify cached data for the optimistic update.

```typescript
  return useMutation({
    mutationFn: async (data: { name: string; description?: string }) => {
      const res = await apiFetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to create project");
      return res.json() as Promise<Project>;
    },
```
**`mutationFn`** — The actual API call. Sends a POST request with the project data as JSON. This is what triggers the entire server-side chain (route → auth → handler → UoW → service → database).

**`as Promise<Project>`** — Type assertion telling TypeScript that `res.json()` returns a `Project`. `Response.json()` returns `Promise<any>` by default.

### The Optimistic Update Pattern

The next three callbacks (`onMutate`, `onError`, `onSettled`) implement optimistic updates — showing the new project in the UI immediately, before the server responds.

```typescript
    onMutate: async (newProject) => {
```
**`onMutate`** — Called **before** `mutationFn`. This is where the optimistic update happens. `newProject` is the same argument passed to `mutate()`: `{ name: "My Project", description: "..." }`.

```typescript
      await queryClient.cancelQueries({ queryKey: ["projects"] });
```
**Cancel in-flight queries.** If a list query is currently fetching, cancel it. Otherwise its response might arrive after our optimistic update and overwrite it with stale data.

```typescript
      const previous = queryClient.getQueryData<ProjectsResponse>(["projects"]);
```
**Save the current cache state.** This snapshot is used to roll back if the mutation fails. `getQueryData` reads from the cache without triggering a fetch.

```typescript
      queryClient.setQueryData<ProjectsResponse>(["projects"], (old) => {
        if (!old) return { projects: [], total: 0 };
        const optimistic: Project = {
          id: `temp-${Date.now()}`,
          userId: "",
          name: newProject.name,
          description: newProject.description || null,
          status: "active",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        return {
          projects: [optimistic, ...old.projects],
          total: old.total + 1,
        };
      });
```
**Write the optimistic data to cache.** Creates a fake project object and prepends it to the existing list. The UI re-renders immediately showing the new project.

**`id: \`temp-${Date.now()}\``** — Temporary ID since we don't have the real UUID yet. It will be replaced when `onSettled` invalidates the cache and the real data arrives.

**`userId: ""`** — We don't have the user ID on the client. Doesn't matter for display purposes.

```typescript
      return { previous };
    },
```
**Return the rollback data.** The object returned from `onMutate` is passed as the `context` parameter to `onError` and `onSettled`.

```typescript
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["projects"], context.previous);
      }
    },
```
**`onError`** — Called if `mutationFn` throws (API returned non-2xx). Restores the cache to the snapshot taken in `onMutate`, removing the optimistic project. The UI updates to reflect that the creation failed.

**`_err, _vars`** — The error and the original mutation variables. Prefixed with `_` because they're unused — we only need `context.previous` for the rollback.

```typescript
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}
```
**`onSettled`** — Called after the mutation completes, whether it succeeded or failed. Invalidates the projects query, which triggers a refetch. This replaces the optimistic data (with its temporary ID) with the real data from the server (with the real UUID).

This runs on both success and error:
- **Success:** Refetch replaces `temp-123` with the real project.
- **Error:** The rollback already happened in `onError`, but the refetch ensures the cache matches the server.

---

## Lines 96–175: `useUpdateProject` and `useDeleteProject`

These follow the exact same optimistic update pattern as `useCreateProject`:

### `useUpdateProject` (lines 96–142)

```typescript
mutationFn: PATCH /api/projects/${id} with partial data
onMutate:   Save previous → update the matching project in cache
onError:    Restore previous cache
onSettled:  Invalidate to refetch
```

The optimistic update modifies the matching project in the cached list:
```typescript
projects: old.projects.map((p) =>
  p.id === id ? { ...p, ...data, updatedAt: new Date().toISOString() } : p
)
```
This spreads the update data over the existing project object, preserving fields that weren't changed.

### `useDeleteProject` (lines 144–175)

```typescript
mutationFn: DELETE /api/projects/${id}
onMutate:   Save previous → filter the project out of cache
onError:    Restore previous cache
onSettled:  Invalidate to refetch
```

The optimistic update removes the project from the cached list:
```typescript
projects: old.projects.filter((p) => p.id !== id),
total: old.total - 1,
```

---

## How the Hooks Fit in the Architecture

```
React Component
  │
  ├── useProjects(search, status)     ← READ: cached, auto-refetching
  ├── useProject(id)                  ← READ: cached, enabled when id exists
  │
  ├── useCreateProject()              ← WRITE: optimistic → POST → refetch
  │     ├── onMutate: show immediately
  │     ├── mutationFn: apiFetch → server chain
  │     ├── onError: rollback
  │     └── onSettled: refetch real data
  │
  ├── useUpdateProject()              ← WRITE: optimistic → PATCH → refetch
  └── useDeleteProject()              ← WRITE: optimistic → DELETE → refetch
```

### Key Design Points

1. **Optimistic updates give instant UI feedback.** The user sees their action reflected immediately, not after a network round trip. If the server rejects it, the UI rolls back.

2. **`onSettled` always refetches.** This ensures the cache matches the server, even if the optimistic data had incorrect generated values (like the temporary ID).

3. **Query keys enable targeted invalidation.** Mutations invalidate `["projects"]` (the list) but not `["project", id]` (individual items). This is intentional — the list refetch covers everything.

4. **All hooks use `apiFetch`.** This ensures account status detection (suspended/deleted 403) works consistently. If a mutation returns 403 with `ACCOUNT_SUSPENDED`, `apiFetch` fires the event that triggers the force-sign-out overlay.

5. **No server state on the client.** The hooks don't store auth tokens, user IDs, or session state. `apiFetch` handles auth transparently via cookies (web) or injected headers (mobile).
