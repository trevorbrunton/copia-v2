# AlayaCare Event Architecture: Constraints for Scoring Applications

Analysis of AlayaCare's API and SQS event patterns, and the architectural implications for building a scoring/matching engine like DappaAi on top of them. Based on review of the AlayaCare OpenAPI specifications (scheduler, employee, employee-skills, client, services).

## Context

AlayaCare delivers operational events (visit changes, employee status changes, client updates) via SQS queues consumed by AWS Lambda, which POSTs webhook payloads to subscribers. The AlayaCare REST API provides CRUD access to individual resources (employees, visits, clients, skills, etc.) via separate endpoints.

DappaAi is a scoring and assignment engine that needs a holistic view of system state — employees, their skills, availability, location, relationship history with clients — to make optimal visit assignment decisions. This document examines where AlayaCare's patterns create friction for this use case, and how DappaAi should use the API efficiently.

## API Capabilities (from OpenAPI Specs)

### What the API provides that DappaAi should leverage

**Rich single-resource GET endpoints:**

- **`GET /visits/{id}`** returns `VisitDetails` with embedded `client` (ClientBranchDetails), `employee` (EmployeeDetails), `service` (VisitServiceDetails with service_code), `skills` (required visit skills), `funders`, `adls`, `tags`, `cancel_code`, `route` (addresses). This is the most data-dense endpoint for scoring context.

- **`GET /employees/{id}`** returns `EmployeeDetails` with embedded `skills` (array), `contacts` (array), `roles`, `groups`, `departments`, `employment_type`, `cost_centre`. Skills are inline — no separate call needed.

- **`GET /clients/{id}`** returns `ClientDetails` with embedded `demographics` (with location), `contacts` (array), `care_team` (array of employee IDs/names — relationship history), `groups`, `tags`, `timezone`, `cost_centre`.

- **`GET /services/{id}`** returns `ServiceDetails` with embedded `patient` (client details), `employee` (provider details), `funders` (with billing percentages), `profile` attributes, `provider_details`.

**Visit list filtering:**

- `is_vacant` (boolean) — find all unassigned visits directly
- `status` (enum: scheduled, vacant, on_hold, cancelled, offered, clocked, late, completed, missed, approved)
- `start_date_from` / `start_date_to` — date range filtering (ISO 8601)
- `client_id` / `alayacare_client_id` — filter by client
- `employee_id` / `alayacare_employee_id` — filter by employee
- `service_id` / `alayacare_service_id` — filter by service
- `tags` (array) — tag-based filtering with OR logic
- `branch_id` — branch filtering
- Standard pagination: `page`, `count` (default 100)

**Employee list filtering:**

- `filter` — substring search on profile/demographics attributes
- `group`, `department`, `designation` — categorical filters
- Standard pagination: `page`, `count`

**Note:** The employee list endpoint returns a simpler schema without embedded skills. Only the individual `GET /employees/{id}` includes skills inline.

### What the API does NOT provide

- **No `visit_offers` endpoint** — this does not exist in production AlayaCare. Mock-alaya added it as a custom extension. DappaAi must use `GET /visits?is_vacant=true&client_id=N` instead.
- **No `include`/`expand` parameters** on list endpoints (the only exception is `include=diagnoses` on the EVV visits endpoint)
- **No bulk/batch fetch** — no way to GET multiple resources by ID in one call
- **No delta/change feed** — no "what changed since timestamp X?" query
- **No webhook event catalogue** in the public API docs — SQS message formats are in a separate "SQS Messaging Specifications" document provided by AlayaCare
- **No rate limit documentation** in the public API guide

## Architectural Friction Points

### 1. Event Granularity Doesn't Match Scoring Intent

AlayaCare emits low-level CRUD events: `visit.vacated`, `visit.created`, `employee.status_changed`. These are database change notifications, not business intent signals.

When a carer resigns, DappaAi receives 20 independent `visit.vacated` events. Each looks like it needs individual attention, but the correct response is to re-score all 20 visits together — they share the same candidate pool, the same constraint change (one fewer carer), and should be prioritised relative to each other (urgent visits first).

**The mismatch:** AlayaCare tells you _what changed in the database_. DappaAi needs to know _what business scenario happened and what decisions are now needed_.

### 2. No Event Correlation in Production

Production SQS/Lambda delivers each event independently with no grouping metadata. There is no correlation ID, batch ID, or causal link between related events. DappaAi has no way to know that 20 `visit.vacated` events arriving within 2 seconds all stem from the same resignation versus 20 unrelated cancellations across different clients.

This forces DappaAi to either:
- Treat every event as independent (wasteful, potentially conflicting scoring decisions)
- Infer correlation through heuristics (same `employee_id` + tight time window), which is fragile

### 3. N+1 Enrichment — Avoidable with the Right Endpoints

The current DappaAi callback pattern per event (observed from server logs):

```
GET /ext/api/v2/employees                          — full employee list (no skills)
GET /ext/api/v2/employees/employees/{id}/skills    — × 28 employees
GET /ext/api/v2/scheduler/visits?client_id=N       — client's visits
GET /ext/api/v2/scheduler/visit_offers?client_id=N — DOES NOT EXIST IN PRODUCTION
GET /ext/api/v2/patients/clients/{id}              — client details
                                                     ~57 calls per event
```

Much of this is avoidable using the API's existing capabilities:

- **`GET /visits/{id}`** returns embedded client, employee, service, and skills in one call — eliminates 3 separate fetches
- **`GET /employees/{id}`** returns embedded skills — eliminates the separate skills call per employee
- **`GET /visits?is_vacant=true&client_id=N`** replaces the non-existent `visit_offers` endpoint
- **`GET /clients/{id}`** returns `care_team` (employee IDs) — relationship history without a separate query

### 4. SQS Standard Queues Don't Guarantee Ordering

Events can arrive out of order:
- A `visit.vacated` could arrive before the `visit.created` for a newly scheduled visit that was immediately reassigned
- An `employee.status_changed` to "terminated" could arrive after the `visit.vacated` events it caused

DappaAi must handle:
- Events referencing entities it hasn't seen yet
- Events that contradict the current local state
- Duplicate deliveries (SQS at-least-once guarantee)

### 5. No Subscription Filtering

AlayaCare sends all events to the webhook endpoint. DappaAi only cares about events affecting scoring decisions (visits needing assignment, employee availability changes, relevant client changes). Events like `visit.updated` where only `service_instructions` changed are noise.

There is no server-side filter — DappaAi must receive, parse, and discard irrelevant events.

### 6. Stale Reads During Event Bursts

When a carer resigns, the DB mutations (terminate employee, vacate visits, create offers) happen in sequence. Events fire as mutations complete. DappaAi receives the first `visit.vacated` event, calls back to GET the employee, and may get `status: "active"` because the status change hasn't propagated yet or hasn't been committed depending on transaction boundaries.

The API provides point-in-time snapshots with no consistency guarantee relative to the event that triggered the callback.

### 7. Rate Limiting Under Burst Load

A single carer resignation triggers 20+ webhook deliveries, each potentially generating 30+ callback requests. That is 600+ API calls in seconds. Scale to multiple concurrent events (sick call + resignation + new client registration) and the application risks hitting AlayaCare's rate limits, causing backed-up queues, retry storms, and cascading delays.

## Optimal Callback Pattern for DappaAi

### Per-event enrichment (when cache is cold or invalidated)

When a `visit.vacated` event arrives with `{ visit_id, employee_id, reason }`:

```
Optimal (2-3 calls):
─────────────────────
GET /visits/{visit_id}              ← returns embedded client, employee,
                                      service, skills, cancel_code
GET /visits?is_vacant=true          ← find all vacant visits needing
    &client_id=N                      assignment (replaces visit_offers)

+ employee roster from cache        ← see caching strategy below
```

Compare to current pattern (57+ calls per event).

### Employee roster caching strategy

The employee roster (with skills) changes infrequently relative to visit events. Cache it and refresh on relevant signals:

**Initial load:** Fetch `GET /employees` (paginated list), then `GET /employees/{id}` for each to get embedded skills. This is N+1 calls but only happens once.

**Cache invalidation triggers:**
- `employee.created` → add to cache, fetch `GET /employees/{new_id}` for full details
- `employee.status_changed` → update status in cache, fetch `GET /employees/{id}` for current state
- `employee.unavailability.created` → fetch unavailabilities for that employee

**Cache TTL:** 30-60 seconds as a safety net. Employee data changes are rare compared to visit events.

### Client data strategy

Client details are returned embedded in `GET /visits/{id}`, so a separate client cache is optional. If scoring needs `care_team` data (relationship history), fetch `GET /clients/{id}` and cache per-client with invalidation on `client.*` events.

## Architectural Implications for DappaAi

DappaAi cannot be a thin webhook handler that reacts to each event in isolation. It needs to be an **event-driven system with its own local state**.

### Recommended Patterns

**1. Local State Cache**

Maintain a local replica of the employee roster (with skills) and active client data. Refresh on change events, not per webhook. Use the individual `GET /employees/{id}` endpoint (which returns skills inline) rather than separate list + skills calls.

**2. Event Batching by Time Window**

Accumulate incoming events for 1–2 seconds before processing. When multiple `visit.vacated` events arrive for the same employee within the window, score them as a batch — shared candidate pool, single enrichment fetch, coordinated assignment decisions.

**3. Events as Cache Invalidation Signals**

Treat webhook events as signals that local state may be stale, not as direct action triggers. "Something changed about employee 7" means: refresh employee 7's cached data, then re-evaluate any pending scoring decisions that involve them.

**4. Idempotent Scoring**

The same event arriving twice (SQS at-least-once) must produce the same result. Scoring the same visit twice must converge to the same assignment. Design scoring as a pure function of current state, not a sequence of event-driven mutations.

**5. Heuristic Correlation**

Since production events lack correlation metadata, infer it:
- Same `employee_id` + multiple `visit.vacated` within N seconds → likely resignation or sick call
- `employee.status_changed` to "terminated" within the same window → confirms resignation
- Use this to prioritise scoring (urgent visits first) and avoid redundant work

**6. Graceful Degradation Under Rate Limits**

Implement backoff and queuing for API callbacks. If rate-limited, continue processing with cached data (potentially stale) rather than blocking. Flag scoring decisions made with stale data for later re-evaluation.

## Critical Production Compatibility Issues

### visit_offers endpoint does not exist

Mock-alaya provides `GET /ext/api/v2/scheduler/visit_offers` as a convenience endpoint. **This does not exist in production AlayaCare.** DappaAi must replace any `visit_offers` calls with:

```
GET /ext/api/v2/scheduler/visits?is_vacant=true&client_id={id}
```

This returns all vacant visits for a client, which is functionally equivalent for scoring purposes.

### Employee list does not include skills

The `GET /employees` list endpoint returns a simpler schema without skills. Only `GET /employees/{id}` (single employee) includes the embedded `skills` array. There is no `?include=skills` parameter on the list endpoint.

### ID system duality

AlayaCare uses dual IDs throughout: internal integer IDs (`alayacare_client_id`) and external string IDs (`client_id`). Query parameters for these are mutually exclusive — you must use one or the other, never both in the same request.

## Summary

| AlayaCare Pattern | Friction for Scoring | DappaAi Mitigation |
|---|---|---|
| Individual CRUD events | No business intent grouping | Time-window batching + heuristic correlation |
| No correlation metadata | Can't link related events | Infer from entity IDs + timestamps |
| Rich single-GET, thin list | Skills/details only on individual GET | Cache employee roster, use `GET /visits/{id}` for context |
| No visit_offers endpoint | Mock-only convenience | Use `GET /visits?is_vacant=true` |
| Client care_team available | Relationship history in one call | Use `GET /clients/{id}` care_team for continuity scoring |
| SQS at-least-once, unordered | Duplicates, out-of-order | Idempotent scoring, state-based not event-based |
| No subscription filtering | Noise events delivered | Client-side filter, ignore irrelevant types |
| No consistency guarantee | Stale reads after events | Cache invalidation, eventual consistency tolerance |
| Rate limits (undocumented) | Burst scenarios hit limits | Backoff, cached fallback, async refresh |

The fundamental tension is that AlayaCare's API is designed for CRUD UIs (fetch one entity, display it, edit it), not for decision engines that need a holistic view of system state to make optimal assignments. However, the single-resource GET endpoints are richer than DappaAi currently exploits — particularly `GET /visits/{id}` with its embedded client, employee, service, and skills data. DappaAi must bridge the remaining gap with its own state management and event processing layer.
