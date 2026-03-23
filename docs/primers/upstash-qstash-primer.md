# Upstash QStash — Primer

## What It Is

QStash is an **HTTP-based message queue and task scheduler** built for serverless environments. It solves a fundamental problem: how do you reliably process background work when your application runs on serverless functions that spin up and down unpredictably?

Traditional message queues (RabbitMQ, AWS SQS, Apache Kafka) use a **pull model** — a long-running consumer process sits and polls the queue for messages. This doesn't work in serverless because there is no long-running process.

QStash uses a **push model**: you publish a message with a destination URL, and QStash delivers it via HTTP POST. Your serverless function receives the message the same way it receives any web request — no special consumer process needed.

---

## How It Works

### The Basic Flow

```
Your App                    QStash                     Your App (different route)
────────                    ──────                     ─────────────────────────

1. Publish message    ──→   2. Stores durably    ──→   3. Delivers via HTTP POST
   with destination URL        (guaranteed)              to your endpoint
                                                         │
                                                         ├─→ Returns 2xx? Done.
                                                         └─→ Returns error? Retry.
```

```typescript
import { Client } from "@upstash/qstash";
const qstash = new Client({ token: process.env.QSTASH_TOKEN! });

await qstash.publishJSON({
  url: "https://your-app.vercel.app/api/process-event",
  body: { type: "visit.vacated", payload: { visit_id: 123 } },
  retries: 3,
});
```

You publish a JSON message to QStash with a URL. QStash stores it durably and delivers it to that URL. If your endpoint returns an error, QStash retries automatically with exponential backoff.

### Core Concepts

**Messages**: A JSON (or raw) payload published to QStash with a destination URL. QStash guarantees **at-least-once delivery** — your message will be delivered, but in rare cases it might be delivered more than once (which is why idempotency matters).

**Retries**: When your endpoint returns a non-2xx status, QStash retries with exponential backoff. You control the maximum retry count (we use 3). After all retries are exhausted, the message goes to the Dead Letter Queue.

**Deduplication**: You can attach a `deduplicationId` to any message. QStash rejects any message with the same ID within a **24-hour window**. This prevents duplicate processing when the same event is sent twice.

**Schedules (Cron)**: QStash can call your endpoint on a CRON schedule — no external cron service needed. Supports all IANA timezones.

**URL Groups**: Publish one message and QStash delivers it to multiple endpoints in parallel (fan-out).

**Callbacks**: Specify a callback URL when publishing. After your destination processes the message, QStash forwards the response to your callback URL — enabling chained workflows.

**Dead Letter Queue (DLQ)**: Messages that exhaust all retries are automatically stored in a DLQ. You can inspect and replay them via the Upstash console or API.

---

## How It Differs from Alternatives

| Aspect | AWS SQS | Google Cloud Tasks | BullMQ | QStash |
|--------|---------|-------------------|--------|--------|
| **Consumer model** | Pull (polling loop or Lambda trigger) | Push (HTTP) | Pull (worker process) | Push (HTTP) |
| **Infrastructure** | Managed but needs Lambda config | Managed, GCP-only | Self-managed Redis + workers | Fully managed, no infrastructure |
| **Serverless fit** | Needs Lambda trigger setup | Good but GCP lock-in | Poor (needs workers) | Native — designed for it |
| **SDK complexity** | Heavy AWS SDK | GCP SDK | Redis + BullMQ packages | Lightweight HTTP client |
| **Deduplication** | Content-based (5-min window) | Task-name-based | Custom | ID-based (24-hour window) |
| **Pricing** | Per-message + request charges | Per-operation | Redis hosting cost | Per-message, simple |

### vs AWS SQS

SQS is the most common comparison. With SQS, you either need a Lambda function configured as an event source (which adds AWS-specific coupling) or a long-running consumer process polling the queue. QStash eliminates both — it pushes directly to your existing API routes.

### vs BullMQ

BullMQ requires you to run Redis and a worker process. In a serverless architecture, you'd need a separate always-on server just for the worker. QStash has no worker — it delivers to your serverless functions via HTTP.

---

## Signature Verification

Since QStash pushes to public HTTP endpoints, how do you know a message is really from QStash and not a random attacker? QStash signs every message with a cryptographic signature.

QStash maintains two signing keys (current + next) for zero-downtime key rotation. The `@upstash/qstash` SDK provides middleware that handles verification automatically:

```typescript
import { verifySignatureAppRouter } from "@upstash/qstash/nextjs";

async function handler(req: Request) {
  // Only reached if the QStash signature is valid
  const event = await req.json();
  // ... process event
}

export const POST = verifySignatureAppRouter(handler);
```

Environment variables used:
- `QSTASH_CURRENT_SIGNING_KEY` — current signing key
- `QSTASH_NEXT_SIGNING_KEY` — next key (for seamless rotation)

---

## Pricing

| Tier | Cost | Includes |
|------|------|----------|
| Free | $0 | 500 messages/day |
| Pay-as-you-go | $1 per 100K messages | No daily limit |
| Pro | $40/month | Better per-message rates, advanced features |

Upstash Workflow runs on top of QStash — each workflow step is a QStash message. A 7-step workflow = 7 messages.

---

## How We Use QStash in This App

### 1. Webhook Forwarding with Deduplication

**The problem**: AlayaCare sends webhook events when data changes (visits, employees, clients). If our app is briefly unavailable, the webhook fails and the event is lost. If AlayaCare retries, we might process the same event twice.

**The solution**: The webhook ingress route validates the shared secret, then immediately publishes the event to QStash rather than processing it inline:

```typescript
// app/api/webhooks/alayacare/route.ts
export async function POST(req: Request) {
  // 1. Validate AlayaCare's shared secret
  const secret = req.headers.get("x-webhook-secret");
  // ... timing-safe comparison ...

  // 2. Forward to QStash for reliable processing
  const event = await req.json();
  await qstash.publishJSON({
    url: `${process.env.APP_URL}/api/webhooks/process-event`,
    body: event,
    deduplicationId: event.event_id,  // 24-hour dedup window
    retries: 3,
  });
  return Response.json({ received: true });
}
```

This gives us:
- **Guaranteed delivery**: If our processing route is down, QStash retries automatically.
- **Deduplication**: If AlayaCare sends the same event twice, QStash rejects the duplicate (24-hour window using the event ID).
- **Fast response**: The webhook returns immediately (200ms) instead of waiting for full event processing (which could take seconds).

### 2. Secure Event Processing

The event processing route receives messages from QStash (not directly from AlayaCare). It uses QStash signature verification to ensure only authentic messages are processed:

```typescript
// app/api/webhooks/process-event/route.ts
import { verifySignatureAppRouter } from "@upstash/qstash/nextjs";

async function handler(req: Request) {
  const event = await req.json();
  switch (event.type) {
    case "visit.vacated":      // → create roster task + trigger workflow
    case "visit.created":      // → sync visit data
    case "visit.updated":      // → sync visit data
    case "visit.cancelled":    // → cancel active workflows + tasks
    case "employee.status_changed":   // → sync + clear cache
    case "employee.unavailability":   // → sync + clear cache
    case "client.created":     // → sync client data
  }
}

export const POST = verifySignatureAppRouter(handler);
```

### 3. Workflow Triggering

When a `visit.vacated` event is processed, the handler triggers an Upstash Workflow (which runs on QStash):

```typescript
const wfClient = new Client({ token: process.env.QSTASH_TOKEN! });
const { workflowRunId } = await wfClient.trigger({
  url: `${process.env.APP_URL}/api/roster/workflow`,
  body: { taskId, visitId, urgency, userId, detectedAt },
});
```

The workflow ID is stored on the roster task so it can be cancelled later if needed.

### 4. Workflow Cancellation

When a visit is cancelled in AlayaCare, the handler cancels any running workflows:

```typescript
await Promise.all(
  activeTasks
    .filter((t) => t.workflow_run_id)
    .map((t) => wfClient.cancel({ ids: [t.workflow_run_id] }).catch(() => {}))
);
```

### 5. SMS Response Notification

When a caregiver replies to an SMS, the response handler uses QStash to notify the waiting workflow:

```typescript
const client = new Client({ token: process.env.QSTASH_TOKEN! });
await client.notify({
  eventId: `caregiver-${taskId}-${employeeId}`,
  eventData: { accepted, declineReason },
});
```

This wakes the workflow's `context.waitForEvent()` step, which has been durably paused waiting for the caregiver's response.

---

## Three Layers of Duplicate Prevention

QStash deduplication is one layer in a three-layer strategy:

| Layer | Where | Window | Mechanism |
|-------|-------|--------|-----------|
| 1. QStash deduplication | Webhook ingress | 24 hours | `deduplicationId: event.event_id` |
| 2. Redis scoring lock | Workflow start | 30 seconds | `SET NX lock:scoring:{visitId}` |
| 3. Xano unique index | Database | Permanent | Unique partial index on `(visit_id, user_id)` where task is active |

Each layer catches duplicates that slip through the previous one — defence in depth.

---

## Why QStash Is the Right Choice

| Requirement | Why QStash Fits |
|-------------|-----------------|
| **Serverless architecture** | Push-based delivery to HTTP endpoints — no consumer process needed |
| **Vercel deployment** | No infrastructure to manage alongside Vercel. Just API routes. |
| **Webhook reliability** | Built-in retries with exponential backoff — never lose an event |
| **Duplicate prevention** | Native 24-hour deduplication window |
| **Security** | Cryptographic signature verification on every message |
| **Cost** | ~700 messages/day at 100 tasks/day — within or near free tier |
| **Unified platform** | Same Upstash account as Redis and Workflow — single billing, single dashboard |
| **No vendor lock-in** | If needed, QStash can be replaced with SQS (+ Lambda trigger), BullMQ (+ worker), or even a simple retry loop. The business logic is pure TypeScript with no QStash dependency. |

---

## Environment Variables

```bash
QSTASH_TOKEN=                    # Client authentication (publishing + triggering)
QSTASH_CURRENT_SIGNING_KEY=      # Signature verification (current key)
QSTASH_NEXT_SIGNING_KEY=         # Signature verification (next key, for rotation)
APP_URL=https://your-app.vercel.app  # Base URL for callback/workflow endpoints
```
