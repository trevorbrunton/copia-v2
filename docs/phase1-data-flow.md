# Phase 1 — End-to-End Data Flow

How data moves through the system from a shift becoming vacant to a caregiver being assigned. Written for non-technical stakeholders.

**Reference**: [`upstash-xano-implementation-spec.md`](./upstash-xano-implementation-spec.md) for technical details.

---

## System Components

| Component | Role | Analogy |
|-----------|------|---------|
| **AlayaCare** | Source of truth for clients, employees, visits, offers | The HR/scheduling system your team uses daily |
| **Next.js App** | The brain — runs scoring, AI reasoning, and cascade logic | The decision-maker |
| **Xano** | Database — stores all rostering data, tasks, and audit logs | The filing cabinet |
| **Upstash Redis** | Fast temporary storage — caches employee data, prevents duplicates | The whiteboard |
| **Upstash QStash** | Message queue — reliably delivers events between components | The internal mail system |
| **Upstash Workflow** | Durable execution engine — runs the contact cascade, survives crashes | The process manager |
| **AWS Bedrock (Claude Haiku)** | AI reasoning — explains recommendations, flags escalations | The advisor |
| **Twilio** | SMS provider — sends/receives caregiver text messages | The phone system |

---

## Flow 1: Keeping Data in Sync

AlayaCare is the source of truth. When anything changes there, our system needs to know.

```
AlayaCare                    Our System
─────────                    ──────────

Employee status changes  ──→  Webhook arrives at Next.js
                              │
                              ├─→ Validates shared secret (is this really AlayaCare?)
                              │
                              └─→ Forwards to QStash (guaranteed delivery)
                                   │
                                   └─→ QStash delivers to Event Processor
                                        │
                                        ├─→ Upserts employee record in Xano
                                        ├─→ Clears cached employee data in Redis
                                        └─→ Records tenant mapping
```

**What gets synced:**
- Employee profile changes (name, status, location)
- Employee unavailability windows (sick days, holidays)
- New clients
- Visit creation, updates, and cancellations

**Why the message queue?** If our system is briefly unavailable, AlayaCare's webhook would fail. QStash holds the message and retries automatically — no data is lost.

**Why the cache clear?** When an employee's status changes (e.g., goes on leave), we clear our cached employee list so the scoring engine always works with fresh data.

---

## Flow 2: Shift Becomes Vacant → Autonomous Filling

This is the core flow. A shift needs a caregiver and the system fills it autonomously.

### Stage 1: Detection

```
AlayaCare                         Our System
─────────                         ──────────

Shift becomes vacant         ──→  "visit.vacated" webhook
(employee called in sick,         │
original offer declined,          ├─→ Validates webhook secret
etc.)                             │
                                  └─→ QStash delivers to Event Processor
                                       │
                                       ├─→ Saves visit data to Xano
                                       ├─→ Creates a Roster Task (status: "idle")
                                       │   with urgency: "planned" or "urgent"
                                       │   (urgent = shift starts within 4 hours)
                                       │
                                       └─→ Triggers the Workflow
```

**What the coordinator sees**: A new task appears on the dashboard with status "idle" and the urgency badge.

### Stage 2: Scoring

```
Workflow Engine
──────────────

Step 0: Acquire Lock
  │  (prevents two workflows running for the same visit)
  │
  ▼
Step 1: Score Candidates
  │
  ├─→ Fetches employee roster from Redis cache (or Xano if cache expired)
  ├─→ Fetches visit details from Xano
  │
  ├─→ Runs Scoring Engine (5 dimensions):
  │     1. Skills match     — does the caregiver have the required qualifications?
  │     2. Relationship     — have they worked with this client before?
  │     3. Proximity        — how far do they live from the client?
  │     4. Workload balance — are they already overloaded this week?
  │     5. Acceptance rate  — do they tend to accept or decline similar shifts?
  │
  ├─→ Applies weight preset:
  │     • "planned" shifts  → balanced weights
  │     • "urgent" shifts   → favours proximity + acceptance rate
  │
  ├─→ Saves ranked candidate list to Xano (on the roster task)
  │
  └─→ Decision gate:
        • 0 candidates?    → Escalate immediately ("No eligible candidates")
        • < 3 candidates?  → Escalate immediately ("Thin bench")
        • 3+ candidates?   → Continue to reasoning
```

**What the coordinator sees**: Task status changes to "scoring", then either "escalated" (with reason) or moves to "reasoning".

### Stage 3: AI Reasoning

```
Workflow Engine
──────────────

Step 2: LLM Reasoning
  │
  ├─→ Builds context package:
  │     • Visit details (time, location, required skills)
  │     • Client profile (care needs, preferences)
  │     • Top-ranked candidates with scores
  │
  ├─→ Sends to Claude Haiku (AWS Bedrock):
  │     "Given this visit and these candidates,
  │      recommend the best match and explain why.
  │      Flag if this should be escalated to a human."
  │
  ├─→ Receives structured response:
  │     • Recommended caregiver + explanation
  │     • Confidence level
  │     • Escalation recommendation (if any)
  │     • Risk factors and trade-offs
  │
  └─→ Decision gate:
        • LLM says "escalate immediately"?  → Escalate with reason
        • LLM unavailable?                  → Continue with scoring-only ranking
        • Otherwise                         → Continue to contacting
```

**What the coordinator sees**: Task status changes to "reasoning". The AI recommendation (with explanation) is saved on the task for the coordinator to review later.

**If the AI is unavailable**: The system falls back to the scoring engine ranking alone — it never blocks on AI availability.

### Stage 4: Contact Cascade (Sequential)

```
Workflow Engine
──────────────

Step 3: Contact Caregivers (one at a time, ranked order)
  │
  │  For each candidate (highest score first):
  │
  ├─→ Checks: is the task still active? (coordinator may have cancelled)
  │
  ├─→ Sends SMS to caregiver:
  │     "Hi [Name], a shift is available on [Date] at [Time]
  │      for [Client]. Reply YES to accept or NO to decline."
  │
  ├─→ Records contact attempt on the task in Xano
  │
  ├─→ Waits for response (timeout: 5 min urgent / 15 min planned)
  │     │
  │     ├─→ Caregiver replies YES  → Go to Assignment
  │     ├─→ Caregiver replies NO   → Record decline, try next candidate
  │     └─→ No response (timeout)  → Record as expired, try next candidate
  │
  └─→ All candidates exhausted?  → Escalate ("All contacts exhausted")
```

**What the coordinator sees**: Task status changes to "contacting". The task card shows each contact attempt in real time — who was contacted, when, and their response.

**Important**: The system contacts caregivers one at a time (sequential cascade). This prevents two caregivers both accepting the same shift.

### Stage 5: Assignment

```
Workflow Engine                               AlayaCare
──────────────                               ──────────

Caregiver accepted!
  │
  ├─→ Updates task status to "accepted"
  │
  ├─→ Creates offer in AlayaCare ──────────→  Offer appears in AlayaCare
  │     (with idempotency key                  for the accepted caregiver
  │      to prevent duplicates)
  │
  ├─→ Write-back succeeded?
  │     │
  │     ├─→ YES: Mark task "completed"
  │     │        Record time-to-fill
  │     │        Log to audit trail
  │     │
  │     └─→ NO:  Escalate to coordinator
  │              ("AlayaCare write-back failed")
  │              Coordinator must create
  │              the offer manually
  │
  └─→ Done
```

**What the coordinator sees**: Task shows "completed" with the assigned caregiver, time-to-fill, and the AI's explanation. If the write-back failed, the task shows "escalated" and the coordinator creates the offer in AlayaCare manually.

**Critical safety rule**: The system never marks a shift as "assigned" unless AlayaCare has confirmed the offer. This prevents mismatches between systems.

---

## Flow 3: Coordinator Intervention

At any point during the cascade, a coordinator can take action through the dashboard.

### Cancel a Task

```
Coordinator clicks "Cancel"
  │
  ├─→ Cancels the running workflow (stops contacting immediately)
  ├─→ Updates task status to "cancelled"
  └─→ Logs to audit trail
```

### Accept the AI Recommendation

```
Coordinator clicks "Accept Recommendation"
  │
  ├─→ Creates offer in AlayaCare for the recommended caregiver
  ├─→ If successful: marks task "assigned"
  └─→ If failed: re-escalates task with error details
```

### Manually Assign a Caregiver

```
Coordinator selects a different caregiver and clicks "Assign"
  │
  ├─→ Creates offer in AlayaCare for the chosen caregiver
  ├─→ If successful: marks task "assigned"
  └─→ If failed: re-escalates task with error details
```

---

## Flow 4: Visit Cancelled

If the visit is cancelled in AlayaCare while the system is mid-cascade:

```
AlayaCare                         Our System
─────────                         ──────────

Visit cancelled              ──→  "visit.cancelled" webhook
                                   │
                                   ├─→ Updates visit status in Xano
                                   │
                                   ├─→ Finds all active tasks for this visit
                                   │
                                   ├─→ Cancels running workflows FIRST
                                   │   (stops SMS outreach immediately)
                                   │
                                   └─→ Then marks all tasks as "cancelled"
                                        with audit log entries
```

**Why cancel workflows first?** If we updated the database first, the workflow might send another SMS in the gap before it gets cancelled. Cancelling the workflow first ensures no more messages go out.

---

## Flow 5: SMS Response Handling

When a caregiver replies to an SMS:

```
Caregiver's phone              Twilio                Our System
──────────────────             ──────                ──────────

Caregiver texts
"YES" or "NO"           ──→   Twilio receives   ──→  SMS webhook arrives
                               the reply              │
                                                      ├─→ Extracts: taskId,
                                                      │   employeeId, accepted,
                                                      │   declineReason
                                                      │
                                                      └─→ Notifies the waiting
                                                           workflow step
                                                           │
                                                           └─→ Workflow resumes
                                                                (see Stage 4 above)
```

---

## Flow 6: Coordinator Dashboard

The dashboard reads directly from Xano (no computation needed).

```
Coordinator opens dashboard
  │
  ├─→ Task list: GET /roster_tasks (filtered, paginated)
  │     Shows: status, urgency, visit details, time-in-state
  │
  ├─→ Task detail: GET /roster_tasks/{id}
  │     Shows: scored candidates, AI recommendation,
  │            contact history, audit trail
  │
  ├─→ Analytics: GET /daily_metrics
  │     Shows: tasks created, filled autonomously,
  │            escalated, avg time-to-fill,
  │            first-contact acceptance rate
  │
  └─→ Audit log: GET /audit_log (search by task, date, action)
        Shows: complete history of every decision and action
```

---

## Escalation Scenarios

The system escalates to a human coordinator when:

| Trigger | When | Example |
|---------|------|---------|
| No candidates | Scoring finds zero eligible caregivers | Everyone with required skills is on leave |
| Thin bench | Fewer than 3 eligible candidates | Only 1-2 people qualified |
| AI recommends escalation | LLM flags a situation needing human judgement | Client has complex needs the model isn't confident about |
| All contacts exhausted | Every contacted caregiver declined or didn't respond | 5 caregivers contacted, all said no |
| AlayaCare write-back failed | Offer couldn't be created in AlayaCare | AlayaCare API is down |
| Time-based | Total elapsed time exceeds threshold | Urgent: 15 min, Planned: 60 min |

---

## Audit Trail

Every action is logged to the audit trail with:
- **What** happened (status change, contact sent, response received)
- **Who** did it (system, workflow, AI, or coordinator)
- **When** it happened
- **Why** (details, reasoning, decline reason)

This provides complete traceability for compliance — you can reconstruct exactly what happened for any task and why every decision was made.

---

## Data Residency Summary

| Data | Where it lives | Why |
|------|----------------|-----|
| Client/employee master data | AlayaCare (source of truth) + Xano (synced copy) | System needs local copy for scoring |
| Roster tasks + contact history | Xano | Our operational data |
| AI recommendations | Xano (on the task) | Stored for audit/review |
| Audit log | Xano | Compliance record |
| Employee roster cache | Redis (30-second TTL) | Performance — avoids fetching 150+ employees per scoring run |
| Scoring locks | Redis (30-second TTL) | Prevents duplicate workflows |
| Workflow execution state | Upstash Workflow | Durable execution — survives server restarts |
| SMS messages | Twilio | Delivery and response tracking |
