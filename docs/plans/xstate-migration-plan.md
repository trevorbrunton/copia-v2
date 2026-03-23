# XState Migration Plan — Durable Rostering State Machine

## Executive Summary

Replace the hand-rolled state machine in `src/services/rostering/workflow-orchestrator.ts` with a **declarative XState v5 state chart** backed by **PostgreSQL persistence**. The machine definition becomes a formal, testable, visualisable schema of valid states and transitions. Durability is achieved by serialising machine snapshots to a JSONB column on `roster_tasks` using XState's built-in `getPersistedSnapshot()` / `createActor({ snapshot })` API.

This approach requires **zero new infrastructure** — no external servers, no new services, no vendor dependency. The state machine runs in-process within the existing Next.js application, sleeping in the database between events and waking on demand.

The trade-off versus a durable workflow engine (Restate, Inngest) is that **timeouts and external event waiting must be handled by an external scheduler** (Supabase `pg_cron` or a lightweight polling endpoint). XState provides the state machine formalism; your application provides the durability layer.

---

## Current Architecture

### State Machine Flow

```
detected → gathering → scoring → reasoning → contacting → cascading → accepted → assigned
                                      ↓            ↓            ↓                    ↓
                                  escalated    escalated    escalated             completed
                                                                                     ↓
                                                                              (write-back failed)
                                                                                  assigned
```

### Key Files

| File | Role | Migration Impact |
|------|------|-----------------|
| `src/services/rostering/workflow-orchestrator.ts` | State machine + orchestration | **Replaced** by XState machine + event processor |
| `src/services/rostering/roster-task-service.ts` | CRUD for roster_tasks | **Modified** — adds `machineSnapshot` column operations |
| `src/services/rostering/cascade-engine.ts` | Pure cascade + escalation logic | **Retained** — called from machine actions |
| `src/services/rostering/urgency-classifier.ts` | Urgency classification | **Retained** — no change |
| `src/services/rostering/audit-service.ts` | Append-only audit log | **Retained** — called from machine actions |
| `src/services/rostering/chat-tools.ts` | 4 read + 3 write tools | **Modified** — write tools send XState events |
| `src/services/rostering/metrics-service.ts` | Daily metrics aggregation | **Retained** — no change |
| `src/services/rostering/outcome-tracker.ts` | Outcome extraction | **Retained** — no change |
| `src/services/rostering/pattern-recognition.ts` | Pattern analysis | **Retained** — no change |
| `src/services/rostering/data-validator.ts` | Input validation | **Retained** — no change |
| `src/server/commands/roster/process-pending-events.ts` | Batch event → task creation | **Simplified** — creates tasks and sends XState events |
| `src/server/commands/roster/advance-roster-task.ts` | Single task advancement | **Replaced** — becomes `sendMachineEvent()` |
| `app/api/v1/webhooks/alayacare/route.ts` | Webhook entry point | **Modified** — sends XState events |
| `src/server/commands/webhooks/handle-visit-vacated.ts` | Scoring + LLM on vacancy | **Modified** — creates task, sends `START` event |
| `app/api/v1/roster/tasks/[id]/route.ts` | Human actions (PATCH) | **Modified** — sends XState events |
| `app/api/v1/roster/tasks/route.ts` | List + create tasks | **Modified** — create sends `START` event |
| `app/api/v1/roster/escalations/route.ts` | Escalated task list | **Retained** — reads from DB |
| `app/api/v1/roster/summary/route.ts` | Roster summary | **Retained** — reads from DB |
| `app/api/v1/roster/process-events/route.ts` | Batch event processing | **Simplified** |

### Current Pain Points (Same as Restate Plan)

1. **No waiting mechanism** — `contacting`/`cascading` cannot suspend for caregiver responses
2. **Three-phase orchestration** — read → external → re-read + persist with optimistic lock
3. **No crash recovery** — work lost between external call and persist
4. **No timeout enforcement** — escalation deadlines have no mechanism to fire
5. **No-op transitions** — `detected→gathering`, `gathering→scoring` do nothing
6. **Two-phase event processing** — webhook → `workflow_events` → batch endpoint → `advanceTask()`
7. **No transition validation** — nothing prevents invalid state jumps

---

## XState Architecture

### Design Principles

1. **Machine is declarative** — all valid states, transitions, and guards defined in one schema
2. **Machine is pure** — no side effects in the machine definition; side effects run after transitions
3. **Machine sleeps in PostgreSQL** — serialised as JSONB, woken by events
4. **Side effects are external** — scoring, LLM, SMS, audit logging happen outside the machine, triggered by state changes
5. **Timeouts use external scheduling** — `pg_cron` or polling endpoint sends `TIMEOUT` events
6. **Row-level locking** — `SELECT ... FOR UPDATE` replaces optimistic locking

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│  Next.js App                                                        │
│                                                                     │
│  ┌─────────────────┐  ┌──────────────────┐  ┌───────────────────┐  │
│  │ Webhook Route    │  │ Roster API Routes│  │ Chat Tools        │  │
│  │ POST /webhooks/* │  │ GET/POST/PATCH   │  │ Read + Write      │  │
│  └────────┬────────┘  └────────┬─────────┘  └────────┬──────────┘  │
│           │                    │                      │             │
│           ▼                    ▼                      ▼             │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  Machine Event Processor                                    │    │
│  │  sendMachineEvent(taskId, event)                            │    │
│  │                                                             │    │
│  │  1. SELECT * FROM roster_tasks WHERE id=$1 FOR UPDATE       │    │
│  │  2. createActor(machine, { snapshot })                      │    │
│  │  3. snapshot.can(event) — validate transition               │    │
│  │  4. actor.send(event) — transition fires                    │    │
│  │  5. getPersistedSnapshot() — serialise new state            │    │
│  │  6. UPDATE roster_tasks SET machine_snapshot = ...          │    │
│  │  7. actor.stop() — release memory                           │    │
│  │  8. Run side effects based on new state                     │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  Side Effect Executor                                       │    │
│  │  Runs AFTER machine transition, OUTSIDE the DB transaction  │    │
│  │                                                             │    │
│  │  scoring   → computeMatch() → send SCORED event             │    │
│  │  reasoning → getRecommendation() → send REASONED event      │    │
│  │  contacting → sendSMS() → store deadline in context         │    │
│  │  accepted  → alayaFetch() write-back → send WRITEBACK_*    │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  Timeout Scheduler (pg_cron or polling endpoint)            │    │
│  │                                                             │    │
│  │  Every 60s: SELECT tasks WHERE status IN                    │    │
│  │    ('contacting','cascading') AND deadline < NOW()          │    │
│  │  → sendMachineEvent(taskId, { type: 'TIMEOUT' })            │    │
│  └─────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                 ┌────────────────────────┐
                 │  PostgreSQL (Supabase)  │
                 │                        │
                 │  roster_tasks table    │
                 │  ├─ id                 │
                 │  ├─ status (text)      │  ← denormalised for queries
                 │  ├─ machine_snapshot   │  ← JSONB (XState persisted state)
                 │  ├─ timeout_at         │  ← timestamptz (for scheduler)
                 │  └─ ...existing cols   │
                 └────────────────────────┘
```

**No new infrastructure required.** The XState machine runs in-process. The only new component is a timeout scheduler, which can be implemented as:
- **Supabase `pg_cron`** — `SELECT cron.schedule('check-timeouts', '* * * * *', $$SELECT ...$$)`
- **Next.js API endpoint** — `GET /api/v1/roster/process-timeouts` called by an external cron (Vercel Cron, Railway cron, GitHub Actions)
- **Supabase Edge Function** — scheduled function that queries and sends timeout events

---

## XState Machine Definition

### Simplified State Chart

The current 11-state machine can be reduced. The `detected→gathering` and `gathering→scoring` no-op transitions are eliminated. The `cascading` state is absorbed into `contacting` (cascade logic runs on `TIMEOUT`/`DECLINED` events within the contacting state).

```
                              ┌──────────┐
                 ┌───────────►│ escalated│ (final)
                 │            └──────────┘
                 │                 ▲
                 │                 │
┌─────┐    ┌────┴───┐    ┌───────┴──┐    ┌──────────┐    ┌────────┐    ┌─────────┐
│idle │───►│scoring │───►│reasoning │───►│contacting│───►│accepted│───►│completed│
└─────┘    └────────┘    └──────────┘    └──────────┘    └────────┘    └─────────┘
                │              │              │               │              │
                ▼              ▼              ▼               │              ▼
           escalated      escalated      escalated            │          assigned
                                         (timeout/           │       (write-back
                                          exhausted)          │        failed)
                                                              │
                                                         ┌────┴────┐
                                                         │cancelled│ (final)
                                                         └─────────┘
```

### Machine Definition

```typescript
// src/services/rostering/machine.ts

import { setup, assign } from "xstate";

// ── Types ──────────────────────────────────────────────────────

export interface RosterMachineContext {
  taskId: string;
  visitId: number;
  clientId: number | null;
  urgency: "planned" | "urgent";

  // Scoring
  matchResult: unknown | null;
  candidateCount: number;

  // Reasoning
  llmRecommendation: unknown | null;
  escalationAdvice: {
    shouldEscalate: boolean;
    urgency: string;
    reason: string;
  } | null;
  confidence: string | null;

  // Contacting
  contacts: Array<{
    employeeId: number;
    employeeName: string;
    rank: number;
    score: number;
    channel: "sms" | "email";
    sentAt: string | null;
    expiresAt: string | null;
    response: "pending" | "accepted" | "declined" | "expired";
    declineReason: string | null;
  }>;
  currentContactIndex: number;
  cascadeStrategy: "sequential" | "parallel";
  maxContacts: number;

  // Resolution
  assignedEmployeeId: number | null;
  escalationReason: string | null;
  writeBackSuccess: boolean | null;

  // Timestamps (ISO strings for JSON serialisation)
  detectedAt: string;
  scoringCompletedAt: string | null;
  firstContactAt: string | null;
  timeoutAt: string | null;  // deadline for current contact/cascade
  resolvedAt: string | null;
}

export type RosterMachineEvent =
  | { type: "START" }
  | { type: "SCORED"; matchResult: unknown; candidateCount: number }
  | { type: "SCORE_FAILED"; reason: string }
  | { type: "REASONED"; recommendation: unknown; escalationAdvice: RosterMachineContext["escalationAdvice"]; confidence: string }
  | { type: "REASON_FAILED" }
  | { type: "CONTACTS_PREPARED"; contacts: RosterMachineContext["contacts"]; timeoutAt: string }
  | { type: "RESPONSE_RECEIVED"; employeeId: number; accepted: boolean; declineReason?: string }
  | { type: "TIMEOUT" }
  | { type: "WRITEBACK_SUCCESS" }
  | { type: "WRITEBACK_FAILED"; reason: string }
  | { type: "CANCEL" }
  | { type: "ESCALATE"; reason: string };

export type RosterMachineInput = {
  taskId: string;
  visitId: number;
  clientId?: number;
  urgency?: "planned" | "urgent";
  matchResult?: unknown;
  llmRecommendation?: unknown;
};

const MIN_VIABLE_CANDIDATES = 3;

// ── Machine Definition ─────────────────────────────────────────

export const rosterTaskMachine = setup({
  types: {
    context: {} as RosterMachineContext,
    events: {} as RosterMachineEvent,
    input: {} as RosterMachineInput,
  },

  guards: {
    hasNoCandidates: ({ context }) => context.candidateCount === 0,
    hasThinBench: ({ context }) =>
      context.candidateCount > 0 && context.candidateCount < MIN_VIABLE_CANDIDATES,
    hasCandidates: ({ context }) => context.candidateCount >= MIN_VIABLE_CANDIDATES,

    recommendsImmediateEscalation: ({ context }) =>
      context.escalationAdvice?.shouldEscalate === true &&
      context.escalationAdvice?.urgency === "immediate",
    hasLowConfidence: ({ context }) => context.confidence === "low",

    hasMoreCandidates: ({ context }) =>
      context.currentContactIndex < context.maxContacts - 1,
    allContactsExhausted: ({ context }) =>
      context.currentContactIndex >= context.maxContacts - 1,
    isParallelCascade: ({ context }) => context.cascadeStrategy === "parallel",

    hasPrecomputedScores: ({ context }) => context.matchResult !== null,
    hasPrecomputedRecommendation: ({ context }) => context.llmRecommendation !== null,
  },

  actions: {
    assignScores: assign({
      matchResult: ({ event }) =>
        event.type === "SCORED" ? event.matchResult : null,
      candidateCount: ({ event }) =>
        event.type === "SCORED" ? event.candidateCount : 0,
      scoringCompletedAt: () => new Date().toISOString(),
    }),

    assignRecommendation: assign({
      llmRecommendation: ({ event }) =>
        event.type === "REASONED" ? event.recommendation : null,
      escalationAdvice: ({ event }) =>
        event.type === "REASONED" ? event.escalationAdvice : null,
      confidence: ({ event }) =>
        event.type === "REASONED" ? event.confidence : null,
    }),

    clearRecommendation: assign({
      llmRecommendation: () => null,
      escalationAdvice: () => null,
      confidence: () => null,
    }),

    assignContacts: assign({
      contacts: ({ event }) =>
        event.type === "CONTACTS_PREPARED" ? event.contacts : [],
      timeoutAt: ({ event }) =>
        event.type === "CONTACTS_PREPARED" ? event.timeoutAt : null,
      firstContactAt: ({ context }) =>
        context.firstContactAt ?? new Date().toISOString(),
    }),

    markContactAccepted: assign({
      contacts: ({ context, event }) => {
        if (event.type !== "RESPONSE_RECEIVED") return context.contacts;
        return context.contacts.map((c) =>
          c.employeeId === event.employeeId
            ? { ...c, response: "accepted" as const, declineReason: null }
            : c
        );
      },
      assignedEmployeeId: ({ event }) =>
        event.type === "RESPONSE_RECEIVED" ? event.employeeId : null,
    }),

    markContactDeclined: assign({
      contacts: ({ context, event }) => {
        if (event.type !== "RESPONSE_RECEIVED") return context.contacts;
        return context.contacts.map((c) =>
          c.employeeId === event.employeeId
            ? {
                ...c,
                response: "declined" as const,
                declineReason: event.declineReason ?? null,
              }
            : c
        );
      },
    }),

    markContactExpired: assign({
      contacts: ({ context }) =>
        context.contacts.map((c, i) =>
          i === context.currentContactIndex && c.response === "pending"
            ? { ...c, response: "expired" as const }
            : c
        ),
    }),

    advanceCascade: assign({
      currentContactIndex: ({ context }) => context.currentContactIndex + 1,
      timeoutAt: () => null, // cleared — side effect will set new deadline
    }),

    setEscalationReason: assign({
      escalationReason: ({ event }) =>
        event.type === "ESCALATE"
          ? event.reason
          : event.type === "SCORE_FAILED"
            ? event.reason
            : "Contacts exhausted",
      resolvedAt: () => new Date().toISOString(),
    }),

    setNoCandidatesEscalation: assign({
      escalationReason: () => "No eligible candidates",
      resolvedAt: () => new Date().toISOString(),
    }),

    setThinBenchEscalation: assign({
      escalationReason: ({ context }) =>
        `Thin bench: ${context.candidateCount} candidate(s)`,
      resolvedAt: () => new Date().toISOString(),
    }),

    setImmediateEscalation: assign({
      escalationReason: ({ context }) =>
        context.escalationAdvice?.reason ?? "LLM recommended escalation",
      resolvedAt: () => new Date().toISOString(),
    }),

    setLowConfidenceEscalation: assign({
      escalationReason: () => "LLM confidence low — needs human review",
      resolvedAt: () => new Date().toISOString(),
    }),

    setContactsExhausted: assign({
      escalationReason: () => "All contacts exhausted",
      resolvedAt: () => new Date().toISOString(),
    }),

    setContactsExhaustedTimeout: assign({
      escalationReason: () => "All contacts exhausted (timeout)",
      resolvedAt: () => new Date().toISOString(),
    }),

    markCompleted: assign({
      writeBackSuccess: () => true,
      resolvedAt: () => new Date().toISOString(),
    }),

    markAssigned: assign({
      writeBackSuccess: () => false,
      resolvedAt: () => new Date().toISOString(),
    }),

    markCancelled: assign({
      resolvedAt: () => new Date().toISOString(),
    }),
  },
}).createMachine({
  id: "rosterTask",
  initial: "idle",

  context: ({ input }) => ({
    taskId: input.taskId,
    visitId: input.visitId,
    clientId: input.clientId ?? null,
    urgency: input.urgency ?? "planned",
    matchResult: input.matchResult ?? null,
    candidateCount: 0,
    llmRecommendation: input.llmRecommendation ?? null,
    escalationAdvice: null,
    confidence: null,
    contacts: [],
    currentContactIndex: 0,
    cascadeStrategy: "sequential",
    maxContacts: 10,
    assignedEmployeeId: null,
    escalationReason: null,
    writeBackSuccess: null,
    detectedAt: new Date().toISOString(),
    scoringCompletedAt: null,
    firstContactAt: null,
    timeoutAt: null,
    resolvedAt: null,
  }),

  // Global cancel — available from any non-final state
  on: {
    CANCEL: {
      target: ".cancelled",
      actions: "markCancelled",
    },
    ESCALATE: {
      target: ".escalated",
      actions: "setEscalationReason",
    },
  },

  states: {
    // ── Idle: waiting for START event ─────────────────────────
    idle: {
      on: {
        START: [
          // Skip scoring if pre-computed (webhook path)
          {
            guard: "hasPrecomputedScores",
            target: "reasoning",
          },
          { target: "scoring" },
        ],
      },
    },

    // ── Scoring: waiting for external scoring result ──────────
    // Side effect: computeMatch() runs outside machine, sends SCORED
    scoring: {
      on: {
        SCORED: [
          {
            guard: "hasNoCandidates",
            target: "escalated",
            actions: ["assignScores", "setNoCandidatesEscalation"],
          },
          {
            guard: "hasThinBench",
            target: "escalated",
            actions: ["assignScores", "setThinBenchEscalation"],
          },
          {
            guard: "hasCandidates",
            target: "reasoning",
            actions: "assignScores",
          },
        ],
        SCORE_FAILED: {
          target: "escalated",
          actions: "setEscalationReason",
        },
      },
    },

    // ── Reasoning: waiting for LLM recommendation ─────────────
    // Side effect: getRecommendation() runs outside, sends REASONED
    reasoning: {
      on: {
        REASONED: [
          {
            guard: "recommendsImmediateEscalation",
            target: "escalated",
            actions: ["assignRecommendation", "setImmediateEscalation"],
          },
          {
            guard: "hasLowConfidence",
            target: "escalated",
            actions: ["assignRecommendation", "setLowConfidenceEscalation"],
          },
          {
            target: "contacting",
            actions: "assignRecommendation",
          },
        ],
        REASON_FAILED: {
          // Proceed without recommendation (scoring-only fallback)
          target: "contacting",
          actions: "clearRecommendation",
        },
      },
    },

    // ── Contacting: waiting for caregiver response or timeout ─
    // Side effect: sendSMS/email runs outside, TIMEOUT from scheduler
    contacting: {
      on: {
        CONTACTS_PREPARED: {
          actions: "assignContacts",
        },
        RESPONSE_RECEIVED: [
          {
            // Accepted
            guard: ({ event }) => event.type === "RESPONSE_RECEIVED" && event.accepted,
            target: "accepted",
            actions: "markContactAccepted",
          },
          {
            // Declined — more candidates available (explicit re-entry triggers side effects)
            guard: "hasMoreCandidates",
            target: "contacting",
            reenter: true,
            actions: ["markContactDeclined", "advanceCascade"],
          },
          {
            // Declined — no more candidates
            guard: "allContactsExhausted",
            target: "escalated",
            actions: ["markContactDeclined", "setContactsExhausted"],
          },
        ],
        TIMEOUT: [
          {
            // Timeout — more candidates available (explicit re-entry triggers side effects)
            guard: "hasMoreCandidates",
            target: "contacting",
            reenter: true,
            actions: ["markContactExpired", "advanceCascade"],
          },
          {
            // Timeout — no more candidates
            guard: "allContactsExhausted",
            target: "escalated",
            actions: ["markContactExpired", "setContactsExhaustedTimeout"],
          },
        ],
      },
    },

    // ── Accepted: waiting for AlayaCare write-back ────────────
    // Side effect: alayaFetch write-back runs outside
    accepted: {
      on: {
        WRITEBACK_SUCCESS: {
          target: "completed",
          actions: "markCompleted",
        },
        WRITEBACK_FAILED: {
          target: "assigned",
          actions: "markAssigned",
        },
      },
    },

    // ── Terminal states ───────────────────────────────────────
    completed: { type: "final" },
    assigned: { type: "final" },    // write-back failed, manual follow-up
    escalated: { type: "final" },
    cancelled: { type: "final" },
  },
});
```

---

## Machine Event Processor

The event processor is the core runtime — it loads a machine from the database, sends an event, runs side effects, and persists the new state.

```typescript
// src/services/rostering/machine-processor.ts

import { createActor, type SnapshotFrom } from "xstate";
import { eq } from "drizzle-orm";
import { rosterTaskMachine, type RosterMachineEvent, type RosterMachineInput } from "./machine";
import { rosterTasks } from "@/src/db/schema";
import { appendAudit } from "./audit-service";
import { computeMatch } from "@/src/services/scoring";
import { getRecommendation } from "@/src/services/reasoning/reasoning-service";
import { buildRecommendationContext } from "@/src/services/recommendation-context";
import { getUrgencyConfig } from "./urgency-classifier";
import { alayaFetch } from "@/src/lib/alayacare-client";
import { logger } from "@/src/lib/logger";
import type { TransactionClient } from "@/src/lib/tenant";

type MachineSnapshot = ReturnType<
  ReturnType<typeof createActor<typeof rosterTaskMachine>>["getPersistedSnapshot"]
>;

/**
 * Send an event to a roster task's state machine.
 *
 * Pattern: load snapshot → validate → transition → persist → side effects
 *
 * Uses SELECT ... FOR UPDATE for concurrency control (replaces optimistic locking).
 * Side effects run AFTER the DB transaction commits.
 */
export async function sendMachineEvent(
  tx: TransactionClient,
  userId: string,
  taskId: string,
  event: RosterMachineEvent
): Promise<{ previousState: string; newState: string; context: unknown }> {
  // 1. Load task with row lock (Drizzle doesn't support .for(), use raw SQL)
  const [task] = await tx.execute<typeof rosterTasks.$inferSelect>(
    sql`SELECT * FROM roster_tasks WHERE id = ${taskId} FOR UPDATE`
  );

  if (!task) throw new Error(`Roster task ${taskId} not found`);

  const snapshot = task.machineSnapshot as MachineSnapshot | null;

  // 2. Create actor from persisted snapshot (or fresh)
  const actor = snapshot
    ? createActor(rosterTaskMachine, { snapshot })
    : createActor(rosterTaskMachine, {
        input: {
          taskId: task.id,
          visitId: task.visitId,
          clientId: task.clientId ?? undefined,
          urgency: (task.urgency as "planned" | "urgent") ?? undefined,
          matchResult: task.matchResult ?? undefined,
          llmRecommendation: task.llmRecommendation ?? undefined,
        },
      });

  actor.start();

  const previousState = stateValue(actor);

  // 3. Validate transition
  if (!actor.getSnapshot().can(event)) {
    actor.stop();
    logger.warn(
      { taskId, event: event.type, currentState: previousState },
      "Invalid state transition attempted"
    );
    throw new Error(
      `Event '${event.type}' not valid in state '${previousState}'`
    );
  }

  // 4. Send event — machine transitions synchronously
  actor.send(event);

  const newSnapshot = actor.getPersistedSnapshot();
  const newState = stateValue(actor);
  const machineContext = actor.getSnapshot().context;

  actor.stop();

  // 5. Persist new state
  await tx
    .update(rosterTasks)
    .set({
      machineSnapshot: newSnapshot,
      status: newState,
      // Denormalise key fields for queryability
      matchResult: machineContext.matchResult,
      llmRecommendation: machineContext.llmRecommendation,
      contacts: machineContext.contacts,
      currentContactIndex: machineContext.currentContactIndex,
      assignedEmployeeId: machineContext.assignedEmployeeId,
      escalationReason: machineContext.escalationReason,
      scoringCompletedAt: machineContext.scoringCompletedAt
        ? new Date(machineContext.scoringCompletedAt)
        : null,
      firstContactAt: machineContext.firstContactAt
        ? new Date(machineContext.firstContactAt)
        : null,
      resolvedAt: machineContext.resolvedAt
        ? new Date(machineContext.resolvedAt)
        : null,
      timeoutAt: machineContext.timeoutAt
        ? new Date(machineContext.timeoutAt)
        : null,
      updatedAt: new Date(),
    })
    .where(eq(rosterTasks.id, taskId));

  // 6. Audit log
  await appendAudit(tx, userId, taskId, {
    action: `${previousState}_to_${newState}`,
    actor: "system",
    details: {
      event: event.type,
      previousState,
      newState,
    },
  });

  logger.info(
    { taskId, event: event.type, from: previousState, to: newState },
    "State machine transition"
  );

  return { previousState, newState, context: machineContext };
}

/**
 * Create a new roster task and initialise its state machine.
 */
export async function createTaskWithMachine(
  tx: TransactionClient,
  userId: string,
  input: RosterMachineInput
): Promise<string> {
  const actor = createActor(rosterTaskMachine, { input });
  actor.start();
  const snapshot = actor.getPersistedSnapshot();
  actor.stop();

  const [created] = await tx
    .insert(rosterTasks)
    .values({
      userId,
      visitId: input.visitId,
      clientId: input.clientId ?? null,
      urgency: input.urgency ?? "planned",
      status: "idle",
      machineSnapshot: snapshot,
      matchResult: input.matchResult ?? null,
      llmRecommendation: input.llmRecommendation ?? null,
    })
    .returning();

  return created.id;
}

function stateValue(actor: ReturnType<typeof createActor<typeof rosterTaskMachine>>): string {
  const value = actor.getSnapshot().value;
  return typeof value === "string" ? value : JSON.stringify(value);
}
```

---

## Side Effect Executor

Side effects (API calls, LLM, SMS) run **after** the machine transition, **outside** the DB transaction. This preserves the current pattern of not holding DB connections during network I/O.

```typescript
// src/services/rostering/side-effects.ts

import { sendMachineEvent } from "./machine-processor";
import { computeMatch } from "@/src/services/scoring";
import { getRecommendation } from "@/src/services/reasoning/reasoning-service";
import { buildRecommendationContext } from "@/src/services/recommendation-context";
import { getUrgencyConfig } from "./urgency-classifier";
import { alayaFetch } from "@/src/lib/alayacare-client";
import { logger } from "@/src/lib/logger";
import type { UnitOfWork } from "@/src/server/uow/types";
import type { AuthContext } from "@/src/server/auth-context";

/** States that trigger automatic side effects (non-waiting, non-terminal). */
const SIDE_EFFECT_STATES = new Set(["scoring", "reasoning", "contacting", "accepted"]);

/**
 * After a machine transition, run the appropriate side effect for the
 * new state. Side effects send follow-up events back to the machine,
 * which may trigger further transitions.
 *
 * Uses a while loop (not recursion) to drive the event loop:
 *   transition → side effect → new event → transition → ...
 * Loop exits when the machine reaches a waiting state (contacting
 * with contacts already sent) or a terminal state.
 */
export async function runSideEffects(
  deps: { uow: UnitOfWork },
  ctx: AuthContext,
  taskId: string,
  initialState: string,
  initialContext: Record<string, unknown>
): Promise<void> {
  let currentState = initialState;
  let currentContext = initialContext;

  while (SIDE_EFFECT_STATES.has(currentState)) {
    const result = await executeSideEffect(deps, ctx, taskId, currentState, currentContext);
    if (!result) break; // Side effect did not produce a follow-up transition (e.g., contacting: waiting)
    currentState = result.newState;
    currentContext = result.context as Record<string, unknown>;
  }
}

/**
 * Execute the side effect for a given state. Returns the new state
 * after the follow-up event, or null if the state is now waiting
 * for an external event (no automatic follow-up).
 */
async function executeSideEffect(
  deps: { uow: UnitOfWork },
  ctx: AuthContext,
  taskId: string,
  state: string,
  machineContext: Record<string, unknown>
): Promise<{ newState: string; context: unknown } | null> {
  switch (state) {
    case "scoring":
      return handleScoringSideEffect(deps, ctx, taskId, machineContext);
    case "reasoning":
      return handleReasoningSideEffect(deps, ctx, taskId, machineContext);
    case "contacting":
      return handleContactingSideEffect(deps, ctx, taskId, machineContext);
    case "accepted":
      return handleAcceptedSideEffect(deps, ctx, taskId, machineContext);
    default:
      return null;
  }
}

async function handleScoringSideEffect(
  deps: { uow: UnitOfWork },
  ctx: AuthContext,
  taskId: string,
  machineContext: Record<string, unknown>
): Promise<{ newState: string; context: unknown }> {
  const visitId = machineContext.visitId as number;
  const urgency = machineContext.urgency as string;
  const config = getUrgencyConfig(urgency as "planned" | "urgent");

  try {
    const matchResult = await computeMatch(visitId, { preset: config.weightPreset });
    const candidates = (matchResult as { candidates?: unknown[] })?.candidates ?? [];

    return deps.uow.run(ctx, async ({ db: tx }) =>
      sendMachineEvent(tx, ctx.principalId, taskId, {
        type: "SCORED",
        matchResult,
        candidateCount: candidates.length,
      })
    );
  } catch (err) {
    logger.error({ taskId, err: String(err) }, "Scoring failed");
    return deps.uow.run(ctx, async ({ db: tx }) =>
      sendMachineEvent(tx, ctx.principalId, taskId, {
        type: "SCORE_FAILED",
        reason: String(err),
      })
    );
  }
}

async function handleReasoningSideEffect(
  deps: { uow: UnitOfWork },
  ctx: AuthContext,
  taskId: string,
  machineContext: Record<string, unknown>
): Promise<{ newState: string; context: unknown }> {
  const visitId = machineContext.visitId as number;
  const urgency = machineContext.urgency as string;
  const matchResult = machineContext.matchResult;

  try {
    const ctxResult = await buildRecommendationContext(
      visitId,
      matchResult,
      urgency as "planned" | "urgent"
    );
    const recommendation = await getRecommendation({
      visit: ctxResult.visit,
      client: ctxResult.client,
      matchResult: matchResult as Parameters<typeof getRecommendation>[0]["matchResult"],
      context: ctxResult.context,
    });

    const rec = recommendation as {
      escalation?: { should_escalate: boolean; urgency: string; reason: string };
      primary?: { confidence: string };
    };

    return deps.uow.run(ctx, async ({ db: tx }) =>
      sendMachineEvent(tx, ctx.principalId, taskId, {
        type: "REASONED",
        recommendation,
        escalationAdvice: rec.escalation ?? null,
        confidence: rec.primary?.confidence ?? "unknown",
      })
    );
  } catch (err) {
    logger.error({ taskId, err: String(err) }, "LLM reasoning failed — falling back");
    return deps.uow.run(ctx, async ({ db: tx }) =>
      sendMachineEvent(tx, ctx.principalId, taskId, { type: "REASON_FAILED" })
    );
  }
}

async function handleContactingSideEffect(
  deps: { uow: UnitOfWork },
  ctx: AuthContext,
  taskId: string,
  machineContext: Record<string, unknown>
): Promise<null> {
  // Prepare and send contact for current candidate
  // Set timeout deadline in context
  // Machine then waits for RESPONSE_RECEIVED or TIMEOUT (from scheduler)
  const contacts = machineContext.contacts as Array<{ employeeId: number }>;
  const index = machineContext.currentContactIndex as number;

  if (index >= contacts.length) return null;

  const urgency = machineContext.urgency as string;
  const config = getUrgencyConfig(urgency as "planned" | "urgent");
  const deadline = new Date(Date.now() + config.expiryMinutes * 60_000).toISOString();

  // TODO: Send actual SMS/email here (currently mock)
  // await smsProvider.send(...)

  await deps.uow.run(ctx, async ({ db: tx }) =>
    sendMachineEvent(tx, ctx.principalId, taskId, {
      type: "CONTACTS_PREPARED",
      contacts: contacts as RosterMachineContext["contacts"],
      timeoutAt: deadline,
    })
  );

  // Return null — machine now waits for external events
  // Timeout scheduler will send TIMEOUT if deadline passes
  return null;
}

async function handleAcceptedSideEffect(
  deps: { uow: UnitOfWork },
  ctx: AuthContext,
  taskId: string,
  machineContext: Record<string, unknown>
): Promise<{ newState: string; context: unknown }> {
  const visitId = machineContext.visitId as number;
  const employeeId = machineContext.assignedEmployeeId as number;

  try {
    await alayaFetch(`/scheduler/visits/${visitId}/offers`, {
      method: "POST",
      body: { employee_id: employeeId },
    });

    return deps.uow.run(ctx, async ({ db: tx }) =>
      sendMachineEvent(tx, ctx.principalId, taskId, { type: "WRITEBACK_SUCCESS" })
    );
  } catch (err) {
    logger.error({ taskId, visitId, employeeId, err: String(err) }, "AlayaCare write-back failed");
    return deps.uow.run(ctx, async ({ db: tx }) =>
      sendMachineEvent(tx, ctx.principalId, taskId, {
        type: "WRITEBACK_FAILED",
        reason: String(err),
      })
    );
  }
}
```

---

## Timeout Scheduler

Timeouts are not durable in XState — they use in-memory `setTimeout` which is lost when the actor stops. The solution is an external scheduler that polls for expired deadlines.

### Option A: Supabase pg_cron (Recommended)

```sql
-- Run every minute: find tasks past their deadline and call the timeout endpoint
SELECT cron.schedule(
  'roster-timeouts',
  '* * * * *',
  $$
    SELECT net.http_post(
      url := current_setting('app.base_url') || '/api/v1/roster/process-timeouts',
      headers := jsonb_build_object(
        'x-cron-secret', current_setting('app.cron_secret')
      ),
      body := jsonb_build_object(
        'task_ids', (
          SELECT jsonb_agg(id) FROM roster_tasks
          WHERE status IN ('contacting', 'cascading')
          AND timeout_at IS NOT NULL
          AND timeout_at < NOW()
        )
      )
    );
  $$
);
```

### Option B: Next.js API Endpoint + External Cron

```typescript
// app/api/v1/roster/process-timeouts/route.ts

export async function POST(req: Request) {
  const traceId = crypto.randomUUID();
  // Validate cron secret (not user auth — this is a system endpoint)
  const secret = req.headers.get("x-cron-secret");
  if (secret !== process.env.CRON_SECRET) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const expiredTasks = await db
    .select({ id: rosterTasks.id })
    .from(rosterTasks)
    .where(
      and(
        inArray(rosterTasks.status, ["contacting", "cascading"]),
        isNotNull(rosterTasks.timeoutAt),
        lte(rosterTasks.timeoutAt, new Date())
      )
    );

  const results = await Promise.allSettled(
    expiredTasks.map(({ id }) =>
      uow.run(systemCtx, async ({ db: tx }) =>
        sendMachineEvent(tx, SYSTEM_USER_ID, id, { type: "TIMEOUT" })
      ).then((result) =>
        runSideEffects(deps, systemCtx, id, result.newState, result.context)
      )
    )
  );

  return Response.json({
    processed: expiredTasks.length,
    succeeded: results.filter((r) => r.status === "fulfilled").length,
    failed: results.filter((r) => r.status === "rejected").length,
  });
}
```

Called by: Vercel Cron (`vercel.json`), Railway cron, GitHub Actions, or any external scheduler — once per minute.

---

## Database Changes

### Migration: Add `machine_snapshot` Column

```sql
-- Migration 013: Add XState machine snapshot column
ALTER TABLE roster_tasks
  ADD COLUMN machine_snapshot JSONB DEFAULT NULL;

-- Add timeout_at for scheduler queries (if not already present)
ALTER TABLE roster_tasks
  ADD COLUMN IF NOT EXISTS timeout_at TIMESTAMPTZ DEFAULT NULL;

-- Index for timeout scheduler polling
CREATE INDEX IF NOT EXISTS idx_roster_tasks_timeout
  ON roster_tasks (timeout_at)
  WHERE status IN ('contacting', 'cascading')
  AND timeout_at IS NOT NULL;

-- The status column remains for queryability (denormalised from machine snapshot)
-- The version column can be removed after migration is complete
-- (row-level locking via SELECT FOR UPDATE replaces optimistic locking)
```

### Data Migration: Existing Tasks

Existing in-progress tasks need machine snapshots created from their current status:

```typescript
// scripts/migrate-to-xstate.ts
// One-time migration: create machine snapshots for existing tasks

const tasks = await db.select().from(rosterTasks).where(/* non-terminal */);

for (const task of tasks) {
  const actor = createActor(rosterTaskMachine, {
    input: {
      taskId: task.id,
      visitId: task.visitId,
      clientId: task.clientId ?? undefined,
      urgency: (task.urgency as "planned" | "urgent") ?? undefined,
      matchResult: task.matchResult ?? undefined,
      llmRecommendation: task.llmRecommendation ?? undefined,
    },
  });
  actor.start();

  // Fast-forward to current status by sending synthetic events
  // (or simply create a snapshot at the current state)
  const snapshot = actor.getPersistedSnapshot();
  actor.stop();

  await db.update(rosterTasks)
    .set({ machineSnapshot: snapshot })
    .where(eq(rosterTasks.id, task.id));
}
```

---

## Migration Steps

### Phase 0: Setup

1. **Install XState v5**
   ```bash
   bun add xstate
   ```

2. **Create machine definition** — `src/services/rostering/machine.ts`
3. **Create event processor** — `src/services/rostering/machine-processor.ts`
4. **Create side effects module** — `src/services/rostering/side-effects.ts`
5. **Write unit tests** — pure transition testing with `transition()` and `initialTransition()`
6. **Run migration** — add `machine_snapshot` and `timeout_at` columns

### Phase 1: Parallel Implementation (No Breaking Changes)

Build the XState machine alongside the existing orchestrator. Route new tasks to XState, existing tasks continue on the old path.

| Task | Detail |
|------|--------|
| Feature flag: `USE_XSTATE_MACHINE` | Controls routing of new tasks |
| New tasks created with `machineSnapshot` | Old tasks have `machineSnapshot = null` |
| `advanceTask()` checks for snapshot | If snapshot exists → XState path; else → old path |
| Integration tests | Full workflow tests via `sendMachineEvent` |

### Phase 2: Webhook Integration

| Current Flow | New Flow |
|---|---|
| Webhook → `workflow_events` → `process-pending-events` → `advanceTask()` | Webhook → create task with machine snapshot → `sendMachineEvent(START)` → `runSideEffects()` |

Changes:
- `handle-visit-vacated.ts` — creates task with `createTaskWithMachine()`, sends `START` event, runs side effects
- `process-pending-events.ts` — simplified to create tasks and send `START` events

### Phase 3: Timeout Scheduler

| Task | Detail |
|------|--------|
| Implement timeout endpoint | `POST /api/v1/roster/process-timeouts` |
| Configure scheduler | pg_cron (preferred) or external cron |
| Add `CRON_SECRET` env var | M2M auth for timeout endpoint |
| Test timeout flow | Task in `contacting` → deadline passes → `TIMEOUT` event → cascade/escalate |

### Phase 4: API Route Migration

| Route | Change |
|---|---|
| `POST /api/v1/roster/tasks` (create) | Uses `createTaskWithMachine()` + `sendMachineEvent(START)` |
| `PATCH /api/v1/roster/tasks/[id]` (human action) | Sends XState events (CANCEL, ESCALATE, RESPONSE_RECEIVED) |
| `GET /api/v1/roster/tasks/[id]` | No change — reads from DB |
| `GET /api/v1/roster/tasks` | No change — reads from DB |
| `GET /api/v1/roster/escalations` | No change — reads from DB |
| `GET /api/v1/roster/summary` | No change — reads from DB |
| `POST /api/v1/roster/process-events` | Simplified or deprecated |
| `GET /api/v1/roster/audit` | No change — reads from DB |
| `GET /api/v1/roster/analytics` | No change — reads from DB |

### Phase 5: Chat Tools Migration

| Tool | Change |
|------|--------|
| Read tools (4) | No change — reads from DB |
| `create_roster_task` | Uses `createTaskWithMachine()` |
| `assign_caregiver` | Sends `RESPONSE_RECEIVED` event with `accepted: true` |
| `cancel_task` | Sends `CANCEL` event |

### Phase 6: Cleanup

- Remove `workflow-orchestrator.ts`
- Remove `advance-roster-task.ts`
- Remove `version` column (row locking replaces optimistic locking)
- Migrate remaining tasks to have `machineSnapshot`
- Remove feature flag
- Update CLAUDE.md and architecture docs

---

## What Gets Retained (No Changes)

Same as Restate plan — all pure functions and data access modules work identically:

- `src/services/scoring/` — entire scoring engine
- `src/services/reasoning/` — LLM reasoning layer
- `src/services/recommendation-context.ts` — context builder
- `src/services/rostering/cascade-engine.ts` — cascade decision logic
- `src/services/rostering/urgency-classifier.ts` — urgency classification
- `src/services/rostering/data-validator.ts` — input validation
- `src/services/rostering/audit-service.ts` — audit logging
- `src/services/rostering/metrics-service.ts` — daily metrics
- `src/services/rostering/outcome-tracker.ts` — outcome extraction
- `src/services/rostering/pattern-recognition.ts` — pattern analysis
- `src/lib/alayacare-client.ts` — AlayaCare API client
- `src/lib/alayacare-cache.ts` — TTL cache

---

## Testing Strategy

### Unit Tests: Pure Transition Testing

XState v5 provides `transition()` and `initialTransition()` for pure, synchronous testing without creating actors:

```typescript
// src/services/rostering/machine.test.ts

import { transition, initialTransition } from "xstate";
import { rosterTaskMachine } from "./machine";

describe("rosterTaskMachine", () => {
  it("starts in idle state", () => {
    const [state] = initialTransition(rosterTaskMachine);
    expect(state.value).toBe("idle");
  });

  it("transitions idle → scoring on START", () => {
    const [initial] = initialTransition(rosterTaskMachine);
    const [next] = transition(rosterTaskMachine, initial, { type: "START" });
    expect(next.value).toBe("scoring");
  });

  it("transitions scoring → escalated when no candidates", () => {
    const [initial] = initialTransition(rosterTaskMachine);
    const [scoring] = transition(rosterTaskMachine, initial, { type: "START" });
    const [next] = transition(rosterTaskMachine, scoring, {
      type: "SCORED",
      matchResult: { candidates: [] },
      candidateCount: 0,
    });
    expect(next.value).toBe("escalated");
  });

  it("transitions scoring → reasoning when candidates available", () => {
    const [initial] = initialTransition(rosterTaskMachine);
    const [scoring] = transition(rosterTaskMachine, initial, { type: "START" });
    const [next] = transition(rosterTaskMachine, scoring, {
      type: "SCORED",
      matchResult: { candidates: [{}, {}, {}] },
      candidateCount: 3,
    });
    expect(next.value).toBe("reasoning");
  });

  it("rejects invalid transitions", () => {
    const [initial] = initialTransition(rosterTaskMachine);
    // SCORED is not valid in idle state
    const [same] = transition(rosterTaskMachine, initial, {
      type: "SCORED",
      matchResult: {},
      candidateCount: 5,
    });
    expect(same.value).toBe("idle"); // no transition
  });

  it("allows CANCEL from any non-final state", () => {
    const [initial] = initialTransition(rosterTaskMachine);
    const [scoring] = transition(rosterTaskMachine, initial, { type: "START" });
    const [cancelled] = transition(rosterTaskMachine, scoring, { type: "CANCEL" });
    expect(cancelled.value).toBe("cancelled");
  });

  it("prevents events on final states", () => {
    const [initial] = initialTransition(rosterTaskMachine);
    const [scoring] = transition(rosterTaskMachine, initial, { type: "START" });
    const [cancelled] = transition(rosterTaskMachine, scoring, { type: "CANCEL" });
    const [same] = transition(rosterTaskMachine, cancelled, { type: "START" });
    expect(same.value).toBe("cancelled"); // final — no transitions
  });
});
```

### Integration Tests: Full Workflow

```typescript
// src/services/rostering/machine-processor.test.ts

describe("sendMachineEvent", () => {
  it("processes full scoring → reasoning → contacting workflow", async () => {
    // Create task
    const taskId = await createTaskWithMachine(tx, userId, {
      taskId: crypto.randomUUID(),
      visitId: 123,
      urgency: "planned",
    });

    // Send START — triggers scoring side effect
    const r1 = await sendMachineEvent(tx, userId, taskId, { type: "START" });
    expect(r1.newState).toBe("scoring");

    // Simulate scoring completion
    const r2 = await sendMachineEvent(tx, userId, taskId, {
      type: "SCORED",
      matchResult: { candidates: [{}, {}, {}] },
      candidateCount: 3,
    });
    expect(r2.newState).toBe("reasoning");

    // Simulate LLM completion
    const r3 = await sendMachineEvent(tx, userId, taskId, {
      type: "REASONED",
      recommendation: {},
      escalationAdvice: null,
      confidence: "high",
    });
    expect(r3.newState).toBe("contacting");
  });

  it("rejects invalid transitions with error", async () => {
    const taskId = await createTaskWithMachine(tx, userId, { ... });
    // Task is in idle — SCORED is not valid
    await expect(
      sendMachineEvent(tx, userId, taskId, { type: "SCORED", matchResult: {}, candidateCount: 5 })
    ).rejects.toThrow("not valid in state 'idle'");
  });
});
```

### Snapshot Serialisation Tests

```typescript
describe("machine persistence", () => {
  it("round-trips through JSON serialisation", () => {
    const actor = createActor(rosterTaskMachine, {
      input: { taskId: "t1", visitId: 1 },
    });
    actor.start();
    actor.send({ type: "START" });

    const persisted = actor.getPersistedSnapshot();
    const json = JSON.stringify(persisted);
    const restored = JSON.parse(json);

    const actor2 = createActor(rosterTaskMachine, { snapshot: restored });
    actor2.start();

    expect(actor2.getSnapshot().value).toBe("scoring");
    expect(actor2.getSnapshot().can({ type: "SCORED", matchResult: {}, candidateCount: 5 })).toBe(true);
    expect(actor2.getSnapshot().can({ type: "START" })).toBe(false);

    actor.stop();
    actor2.stop();
  });
});
```

---

## Advantages

### Transition Validation

| Aspect | Current | XState |
|--------|---------|-------|
| Invalid transitions | Nothing prevents `detected → completed` | `snapshot.can(event)` validates before sending; invalid events are no-ops |
| Valid transitions | Implicit in `switch` cases | Declared in machine schema — visible, testable, visualisable |
| Guard conditions | Manual `if` checks scattered across step handlers | Named guards: `hasCandidates`, `shouldEscalate`, composable with `and`/`or`/`not` |
| Global events | Manually checked in each state | `on: { CANCEL }` at root level — available from any non-final state |

### Testability

| Aspect | Current | XState |
|--------|---------|-------|
| Unit testing | Trace through imperative `switch` + mock all dependencies | `transition(machine, state, event)` — **pure function**, no mocks needed |
| Integration testing | Mock `alayaFetch`, `getRecommendation`, etc. | Same mocking, but machine logic tested separately and purely |
| Transition coverage | Manual inspection | Enumerate all `(state, event)` pairs programmatically |
| Invalid transition detection | Runtime errors (or silent bugs) | `snapshot.can(event)` returns `false` — testable assertion |

### Visualisation

The machine definition can be loaded into [Stately Inspector](https://stately.ai/inspect) or the [Stately Editor](https://stately.ai/editor) for visual rendering of the state chart. This provides:
- Visual documentation of all valid states and transitions
- Interactive exploration of guard conditions
- Automatic detection of unreachable states
- Shareable diagrams for stakeholder communication

### Code Organisation

| Aspect | Current | XState |
|--------|---------|-------|
| State logic | 428-line `workflow-orchestrator.ts` mixing state transitions, side effects, persistence | Machine definition (pure logic) + event processor (persistence) + side effects (I/O) — clear separation |
| Adding a new state | Modify `switch`, add to `TERMINAL_STATUSES`, update `persistStepResult` | Add state to machine schema — compiler enforces completeness |
| Adding a new event | Add case to `switch`, hope you covered all states | Add to event type union — TypeScript enforces handler coverage |

### Zero Infrastructure

| Aspect | XState + PostgreSQL | Restate | Step Functions |
|--------|-------------------|---------|---------------|
| New infrastructure | None | Restate server | Lambda + CDK + IAM |
| Deployment change | None | New service endpoint | New AWS resources |
| Vendor dependency | None (XState is MIT) | Restate (BSL license) | AWS lock-in |
| Cost | $0 | $0-$75+/month | $0.025/1K transitions |
| Local development | `bun dev` (unchanged) | Restate server required | SAM/Docker required |

---

## Limitations and Mitigations

| Limitation | Impact | Mitigation |
|-----------|--------|------------|
| **No durable timeouts** — `after` uses `setTimeout`, lost on process restart | Medium | Store `timeoutAt` in context; external scheduler (pg_cron) sends `TIMEOUT` events every 60s |
| **No durable sleep** — cannot suspend waiting for SMS response | Medium | Machine stays in `contacting` state; SMS webhook sends `RESPONSE_RECEIVED` event; timeout scheduler handles expiry |
| **No automatic retries** — side effects that fail need manual retry logic | Low | Side effect executor handles retries; machine receives success/failure events |
| **Row-level locking** — `SELECT ... FOR UPDATE` via raw SQL (Drizzle ORM doesn't support `.for()`) blocks concurrent events on same task | Low | Acceptable for this workload; tasks rarely receive concurrent events. Consider advisory locks if contention increases |
| **Snapshot size** — JSONB column grows with contact history | Low | Contact arrays are bounded by `maxContacts` (10). Typical snapshot ~2-5KB. Well within JSONB limits |
| **No built-in observability** — no dashboard like Restate/Step Functions | Low | Stately Inspector for development; structured logging + audit log for production. Can build a simple admin UI querying `roster_tasks` |
| **Actor restart on restore** — invoked actors would restart | N/A | Machine design avoids `invoke` — side effects are external. No invoked actors to restart |

---

## Risks and Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| **Timeout scheduler reliability** — if pg_cron or external cron fails, contacts don't expire | Medium | Health check monitoring on scheduler; fallback: manual `process-timeouts` endpoint callable from admin UI |
| **Snapshot schema evolution** — changing the machine definition may invalidate persisted snapshots | Medium | XState snapshots include `value` + `context` but not the machine definition. Context shape changes need migration scripts. Add `schemaVersion` to context for forward compatibility |
| **Concurrent event delivery** — two events for same task arrive simultaneously | Low | `SELECT FOR UPDATE` serialises processing. Second event waits for first to commit. If first changes state, second may become invalid (caught by `can()` check) |
| **Side effect failure** — external API call fails after machine transitions | Low | Machine design separates transition from side effect. Side effects send follow-up events (SCORE_FAILED, WRITEBACK_FAILED). Machine handles both success and failure paths |
| **XState v5 stability** — major version changes could affect API | Low | XState v5 is stable (released Dec 2023). `setup()` API is the recommended pattern. Pin version in `package.json` |

---

## Comparison with Restate Approach

| Aspect | XState + PostgreSQL | Restate |
|--------|-------------------|---------|
| **Infrastructure** | None — runs in-process | Restate server (new component) |
| **Durability** | Manual (snapshot serialisation + pg_cron) | Built-in (journaled execution) |
| **Timeouts** | External scheduler (pg_cron, 60s granularity) | Built-in (`ctx.sleep()`, millisecond precision) |
| **External event waiting** | Machine sleeps in DB; webhook sends event | Awakeables (native suspension) |
| **Crash recovery** | Side effects may need retry (machine state is safe) | Automatic replay from journal |
| **Transition validation** | `snapshot.can()` — formal, testable | Implicit in workflow code |
| **Visualisation** | Stately Inspector / Editor | Restate dashboard |
| **Testing** | Pure `transition()` function — no infra needed | Requires Restate test server |
| **Vendor coupling** | None (MIT license) | BSL license, server dependency |
| **Complexity** | More application code (processor, side effects, scheduler) | Less application code, more infrastructure |
| **Maturity** | XState: very mature (2018+) | Restate: GA 2024, younger |
| **Best for** | Teams that want zero infrastructure + formal state machine | Teams that want built-in durability + durable timeouts |

### When to Choose XState + PostgreSQL

- You want **zero new infrastructure** and no vendor dependency
- You value **formal state machine properties** (testable transitions, visualisation, guards)
- Your timeout granularity of ~60s (cron-based) is acceptable
- You want the state machine logic to be **fully in your codebase** and testable without external services
- You already have a scheduler solution (pg_cron, Vercel Cron)

### When to Choose Restate

- **Durable timeouts** with millisecond precision are critical
- You need **native external event suspension** (awakeables)
- You want **automatic crash recovery** for long-running side effects
- You're willing to operate an additional service for these benefits
- The workflow will grow significantly in complexity

---

## Decision Points

1. **Timeout scheduler**: pg_cron (recommended — already in Supabase) vs external cron vs Vercel Cron? pg_cron requires the `pg_cron` extension enabled in Supabase and `pg_net` for HTTP calls.

2. **Snapshot schema versioning**: Add `schemaVersion` field to context from day one? Recommendation: yes, start with `schemaVersion: 1` for forward compatibility.

3. **Parallel cascade**: Use XState parallel states (fixed slots) or handle in side effect executor (loop over candidates)? Recommendation: handle in side effect executor for flexibility — parallel states require fixed region count at definition time.

4. **State simplification**: The current 11-state machine can be reduced to 8 states (eliminating `detected`, `gathering`, `cascading`). Proceed with simplified chart? Recommendation: yes, the no-op transitions add complexity without value.

5. **Feature flag rollout**: Use `USE_XSTATE_MACHINE` env var to route new tasks? Recommendation: yes, enables gradual migration and rollback.

---

## Timeline Estimate

| Phase | Scope | Dependencies |
|-------|-------|-------------|
| Phase 0: Setup | Install XState, create machine + processor + side effects, migration | None |
| Phase 1: Parallel implementation | Feature flag, new tasks use XState, old tasks unchanged | Phase 0 |
| Phase 2: Webhook integration | Webhooks create XState-backed tasks | Phase 1 |
| Phase 3: Timeout scheduler | pg_cron or external cron + timeout endpoint | Phase 2 |
| Phase 4: API route migration | Human actions send XState events | Phase 3 |
| Phase 5: Chat tools migration | Write tools send XState events | Phase 4 |
| Phase 6: Cleanup | Remove old orchestrator, version column, feature flag | All phases complete |

Phases 0-3 are the minimum viable migration. Phases 4-6 can follow incrementally.
