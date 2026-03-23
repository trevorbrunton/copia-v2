# Upstash Workflow — Primer

## What It Is

Upstash Workflow is a **durable execution engine for serverless functions**. It lets you write long-running, multi-step processes as a single TypeScript function that survives server restarts, function timeouts, and transient failures.

The core problem it solves: serverless functions have strict time limits (10 seconds on Vercel's free tier, 60 seconds on Pro). A roster task that needs to score candidates, call an LLM, send SMS messages, and wait for replies cannot complete in one function invocation. Upstash Workflow breaks this into durable **steps**, each executed as a separate serverless function call, with the engine managing state, retries, and resumption.

---

## The Mental Model

Think of it like a save game in a video game. Each step in your workflow is a checkpoint. If the game crashes, you resume from the last checkpoint — not from the beginning.

```
Step 1: Score candidates          ← checkpoint saved
Step 2: Get AI recommendation     ← checkpoint saved
Step 3: Send SMS to caregiver #1  ← checkpoint saved
Step 4: Wait for SMS reply        ← paused (no compute running)
         ... 10 minutes pass ...
Step 4: Reply received!           ← checkpoint saved
Step 5: Create offer in AlayaCare ← checkpoint saved
Step 6: Mark task complete        ← done
```

If the function crashes at Step 3, the workflow resumes at Step 3 — Steps 1 and 2 are not re-executed because their results are already saved.

---

## How It Works Under the Hood

Upstash Workflow is built on top of **QStash** (Upstash's message queue). The mechanics:

1. You define a workflow as a Next.js API route using `serve()`.
2. Each `context.run()`, `context.sleep()`, or `context.waitForEvent()` call defines a **step**.
3. When a step completes, its return value is stored in a **journal** on Upstash's servers.
4. QStash publishes a message back to your workflow route to trigger the next step.
5. On each invocation, the workflow function re-executes from the top. Completed steps return their stored results instantly (the callback is not called). The first uncompleted step actually runs.

```
Invocation 1:
  context.run("step-1", fn1)  →  executes fn1, stores result, STOPS

Invocation 2 (triggered by QStash):
  context.run("step-1", fn1)  →  returns stored result (fn1 NOT called)
  context.run("step-2", fn2)  →  executes fn2, stores result, STOPS

Invocation 3 (triggered by QStash):
  context.run("step-1", fn1)  →  returns stored result
  context.run("step-2", fn2)  →  returns stored result
  context.run("step-3", fn3)  →  executes fn3, stores result, STOPS
```

Each invocation is a fresh serverless function call — short-lived, well within Vercel's time limits. But the overall workflow can run for minutes, hours, or even days.

---

## Core API

### `context.run(name, callback)`

Executes the callback **exactly once** (barring retries) and stores the return value. On subsequent invocations, returns the stored result without calling the callback.

```typescript
const result = await context.run("score-candidates", async () => {
  const employees = await getCachedEmployeeRoster(xano, userId);
  const visit = await xano.get(`/visits/${visitId}`);
  return computeMatch(visit, employees, { preset: "planned" });
});
// result is available for subsequent steps
```

**Return values are stored in the journal.** Only return serialisable data. Avoid returning PII or large payloads — return IDs and metadata instead, and store the full data in your database.

### `context.waitForEvent(name, eventId, options)`

Pauses the workflow until an external event arrives or a timeout expires. **No serverless function is running during the wait** — zero compute cost.

```typescript
const { eventData, timeout } = await context.waitForEvent(
  "wait-for-sms-reply",
  `caregiver-${taskId}-${employeeId}`,
  { timeout: "15m" }
);

if (timeout) {
  // Caregiver didn't respond in 15 minutes
} else if (eventData.accepted) {
  // Caregiver accepted the shift
}
```

To wake a waiting workflow, an external system calls:

```typescript
const client = new Client({ token: process.env.QSTASH_TOKEN! });
await client.notify({
  eventId: `caregiver-${taskId}-${employeeId}`,
  eventData: { accepted: true },
});
```

This is the key mechanism for **human-in-the-loop** workflows — the system waits for a person (the caregiver) to respond.

### `context.sleep(name, seconds)`

Durably pauses the workflow for a specified duration. Survives server restarts, redeployments, and function recycling. Can last hours, days, or months.

```typescript
await context.sleep("wait-before-retry", 300); // 5 minutes
```

### Workflow Cancellation

Workflows can be cancelled programmatically:

```typescript
const client = new Client({ token: process.env.QSTASH_TOKEN! });
await client.cancel({ ids: [workflowRunId] });
```

In this app, when a visit is cancelled in AlayaCare, the webhook handler cancels any running workflows for that visit to stop SMS outreach immediately.

---

## The Critical Rule: Side Effects Inside Steps Only

Because the workflow function re-executes from the top on every step, **any code outside of a step wrapper runs on every single invocation**. This leads to the most important developer discipline rule:

### What Must Be Inside `context.run()`

- API calls (Xano reads/writes, AlayaCare calls)
- Database operations
- SMS/email sending
- Logging (if you want it to happen once)
- Any operation with observable side effects

### What Must NOT Be Outside Steps

- `Date.now()` — would return a different value on each re-execution
- `Math.random()` — would produce different results
- `crypto.randomUUID()` — would generate different IDs
- `fetch()` calls — would execute on every step resumption
- Any mutation or write operation

### What Is Safe Outside Steps

- Creating stateless clients: `const xano = createXanoClient(...)` — produces the same client each time
- Pure computation: `const config = getUrgencyConfig(urgency)` — same input, same output
- Reading from the step payload: `const { taskId, visitId } = context.requestPayload`
- Constants: `const TERMINAL_STATUSES = ["cancelled", "completed", "escalated"]`
- Conditional branches based on step results (e.g., `if (scoringMeta.candidateCount === 0)`)

### Example: Right vs Wrong

```typescript
// ❌ WRONG — Date.now() runs on every re-execution, producing different values
const startTime = Date.now();
await context.run("step-1", async () => { /* ... */ });
await context.run("step-2", async () => {
  console.log(`Elapsed: ${Date.now() - startTime}`); // startTime is different each time!
});

// ✅ RIGHT — capture time inside a step
const startTime = await context.run("capture-time", () => Date.now());
await context.run("step-1", async () => { /* ... */ });
await context.run("step-2", async () => {
  console.log(`Elapsed: ${Date.now() - startTime}`); // startTime is stable
});
```

---

## Retry Behaviour

Retries are configured at the workflow level:

```typescript
export const { POST } = serve(
  async (context) => { /* ... */ },
  { retries: 3 }
);
```

When a step throws an error:
1. The entire workflow invocation is retried (new QStash message).
2. All previously completed steps are skipped (their results are in the journal).
3. Only the failed step is re-attempted.
4. Each retry counts as one QStash message for billing.

Because steps can theoretically run twice (the step completes but the acknowledgment is lost), all steps should be designed to be **idempotent**. In this app, idempotency is ensured through:
- Idempotency keys on audit log writes: `${taskId}-${action}-${stepName}`
- Dedup checks before SMS sends: check if employee was already contacted
- `Idempotency-Key` headers on AlayaCare API calls
- Terminal status checks before PATCH operations

---

## How We Use Workflow in This App

The entire autonomous shift-filling process runs as a single Upstash Workflow defined in `app/api/roster/workflow/route.ts`:

### Step 0: Deduplication Lock

```
context.run("acquire-scoring-lock")
  └─→ Redis SET NX lock:scoring:{visitId}
      ├─→ Lock acquired? Continue.
      └─→ Lock exists? Return early (another workflow is handling this visit).
```

### Step 1: Score Candidates

```
context.run("score")
  ├─→ Fetch employee roster (from Redis cache or Xano)
  ├─→ Fetch visit details (from Xano)
  ├─→ Run scoring engine (5 dimensions: skills, relationship, proximity, workload, acceptance)
  ├─→ Save results to Xano
  └─→ Return metadata to journal (candidate count + IDs — no PII)

Decision gates:
  • 0 candidates → escalate immediately
  • < 3 candidates → escalate (thin bench)
  • 3+ candidates → continue
```

### Step 2: AI Reasoning

```
context.run("reason")
  ├─→ Build context package (visit + client + scored candidates)
  ├─→ Call Claude Haiku via AWS Bedrock
  └─→ Return recommendation (best match, explanation, escalation advice)

Fallback: if LLM is unavailable, continue with scoring-only ranking (audited).
Decision gate: if LLM says "escalate immediately" → escalate with reason.
```

### Steps 3–N: Sequential Contact Cascade

```
For each ranked candidate (highest score first):
  │
  context.run("send-contact-{i}")
  │  ├─→ Check: is task still active? (coordinator may have cancelled)
  │  ├─→ Check: already contacted this employee? (dedup on retry)
  │  ├─→ Send SMS
  │  └─→ Record contact attempt in Xano
  │
  context.waitForEvent("wait-response-{i}")
  │  ├─→ Wait for SMS reply (5min urgent / 15min planned)
  │  ├─→ Caregiver accepts → go to assignment
  │  ├─→ Caregiver declines → record, try next
  │  └─→ Timeout → record as expired, try next
  │
  └─→ All contacts exhausted? → escalate
```

### Assignment Steps

```
context.run("mark-accepted")
  └─→ Update task status to "accepted"

context.run("alayacare-writeback")
  ├─→ Create offer in AlayaCare (with Idempotency-Key header)
  ├─→ Success → continue to finalize
  └─→ Failure → escalate ("AlayaCare write-back failed")

context.run("finalize")
  └─→ Mark task "completed", record time-to-fill
```

### Why `context.run()` for AlayaCare Write-Back (Not `context.call()`)

Upstash Workflow offers `context.call()` which makes HTTP calls through Upstash's infrastructure. We deliberately use `context.run()` with `alayaFetch()` instead because:
- AlayaCare API credentials stay on our server — they never pass through Upstash's infrastructure.
- We control the timeout and error handling directly.

---

## Pricing

Workflow pricing is based on QStash messages — each step = 1 message:

| Operation | Messages |
|-----------|----------|
| `context.run()` | 1 |
| `context.sleep()` | 1 |
| `context.waitForEvent()` | 1 |
| `context.call()` | 2 (Upstash makes the HTTP call) |
| Each retry | 1 additional |

A typical roster task uses ~7 messages (lock + score + reason + 2 contacts + wait + finalize). At 100 tasks/day = ~700 messages/day, within or near the free tier.

| Tier | Cost |
|------|------|
| Free | 1,000 messages/day |
| Pay-as-you-go | $1 per 100K messages |

---

## How It Compares to Alternatives

### vs Temporal

Temporal is the gold standard for durable execution. It's more powerful (supports complex saga patterns, versioning, visibility APIs) but requires running a **dedicated server cluster** — either self-hosted or via Temporal Cloud ($200+/month). For a startup with ~100 tasks/day, Temporal is significant operational overhead for features we don't need yet.

Upstash Workflow deploys as a standard Next.js API route. No servers, no infrastructure, pay-per-use.

### vs Inngest

Inngest is the closest competitor. It uses a very similar step-based replay model. The key difference: Upstash Workflow is part of the broader Upstash ecosystem (Redis + QStash + Workflow), which we already use for caching and rate limiting. Using one platform for everything simplifies billing, reduces vendor count, and means the components are tested to work together.

### vs Restate

Restate was evaluated (see `docs/plans/restate-migration-plan.md`). Like Temporal, it requires a separate server deployment — more powerful but more operational burden for our current scale.

### vs AWS Step Functions

Step Functions use a JSON-based state machine definition (Amazon States Language). The workflow logic in this app — scoring with dynamic candidate counts, LLM calls with fallback, contact loops with per-candidate branching — would be extremely verbose in JSON and nearly impossible to unit test. Upstash Workflow keeps the logic in TypeScript where it can be tested, reviewed, and debugged normally.

### Summary

| | Temporal | Inngest | Restate | Step Functions | **Upstash Workflow** |
|---|---|---|---|---|---|
| Infrastructure | Server cluster | Managed | Server | Managed (AWS) | **None (serverless)** |
| Language | TypeScript/Go/Java | TypeScript | TypeScript/Java | JSON (ASL) | **TypeScript** |
| Deployment | Separate | Separate | Separate | AWS Console | **Next.js API route** |
| Minimum cost | $200+/mo | Free tier | Self-hosted | Pay-per-transition | **Free tier** |
| waitForEvent | Yes | Yes | Yes | Callback | **Yes** |
| Testability | Good | Good | Good | Poor (JSON) | **Good (TypeScript)** |
| Vercel native | No | Adapter | No | No | **Yes** |

---

## Developer Code Review Checklist

From the implementation spec — verify these on every workflow change:

- [ ] Every API call inside a `context.run()` or `context.waitForEvent()`
- [ ] No `Date.now()` or other non-deterministic values outside steps
- [ ] Every `xano.post("/audit_log", ...)` includes `idempotency_key`
- [ ] Every direct PATCH to `roster_tasks` checks terminal status first
- [ ] Contact array appends check for existing `employee_id` (dedup on retry)
- [ ] AlayaCare API calls include `Idempotency-Key` header
- [ ] Scoring lock acquired before scoring step
- [ ] `context.run()` returns only IDs/metadata — no PII in workflow journal

---

## Environment Variables

Upstash Workflow uses the same QStash credentials:

```bash
QSTASH_TOKEN=                    # Client authentication
QSTASH_CURRENT_SIGNING_KEY=      # Signature verification
QSTASH_NEXT_SIGNING_KEY=         # Key rotation support
APP_URL=https://your-app.vercel.app  # Workflow route base URL
```
