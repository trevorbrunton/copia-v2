# Phase 1 Architecture — Autonomous Shift-Filling & Rostering

Architecture for the Phase 1 MVP: text-based autonomous shift filling with LLM reasoning, multi-channel communication, workflow orchestration, and human-in-the-loop oversight.

**Reference documents:**
- Requirements: `docs/poc.txt` (Phase 1 MVP section)
- Traceability: `docs/poc-traceability.md` (P1.1–P1.21)
- Scoring engine: `docs/scoring-engine-architecture.md` (PoC 1 dependency)
- Delivery plan: `docs/plans/poc-delivery-plan.md`
- Roster evolution: `docs/roster-evolution-strategy.md` (A→D→C phased approach)
- Main architecture: `docs/ARCHITECTURE.md`

---

## System Overview

Phase 1 builds on top of PoC 1 (scoring engine) and PoC 2 (LLM reasoning validation) to deliver end-to-end autonomous shift filling.

```
                         ┌─────────────────────────────────────┐
                         │       Trigger Sources                │
                         │  AlayaCare webhook  │  Email inbox   │
                         │  Manual request     │  Conversational│
                         └──────────┬──────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────┐
│                    Workflow Orchestrator                              │
│                                                                      │
│  1. Trigger detection ──► 2. Context gathering ──► 3. Scoring        │
│                                                         │            │
│  4. LLM reasoning ──► 5. Decision (assign │ escalate │ cascade)      │
│         │                     │                │                     │
│         ▼                     ▼                ▼                     │
│  6. Communication      7. Assignment     8. Escalation               │
│     dispatch              execution        to human                  │
│         │                     │                │                     │
│         ▼                     ▼                ▼                     │
│  9. Response monitoring ──► 10. Outcome logging ──► 11. Learning     │
└──────────────────────────────────────────────────────────────────────┘
         │                      │                        │
         ▼                      ▼                        ▼
┌──────────────┐    ┌───────────────┐      ┌──────────────────────┐
│ Communication │    │  AlayaCare    │      │  Human-in-the-Loop   │
│  Channels     │    │  API          │      │  Dashboard           │
│  SMS │ Email  │    │  (write-back) │      │  Escalation console  │
│  App notif    │    │               │      │  Audit trail         │
└──────────────┘    └───────────────┘      │  Analytics           │
                                           │  Conversational UI   │
                                           └──────────────────────┘
```

---

## Architecture Layers

Phase 1 introduces three new architectural layers on top of the existing stack:

```
┌─────────────────────────────────────────────────────────────────┐
│  Human-in-the-Loop Interface (UI)                                │
│  Dashboard, escalation console, audit viewer, chat interface     │
├─────────────────────────────────────────────────────────────────┤
│  Workflow Orchestrator (new)                                     │
│  State machine for shift-filling lifecycle                       │
├──────────────┬──────────────────────────────────────────────────┤
│  LLM Reasoning│  Communication     │  Scoring Engine             │
│  Layer (new)  │  Layer (new)       │  (from PoC 1)               │
│  Bedrock API  │  SMS, email, app   │  Pure algorithmic            │
├──────────────┴──────────────────────────────────────────────────┤
│  AlayaCare Integration (existing)                                │
│  alayaFetch → proxy routes → webhooks (new)                      │
├─────────────────────────────────────────────────────────────────┤
│  Core Platform (existing)                                        │
│  Auth, UoW, RLS, logging, error handling                         │
└─────────────────────────────────────────────────────────────────┘
```

---

## 1. Workflow Orchestrator

The central coordination engine that manages the shift-filling lifecycle.

### State Machine

Each shift-filling task progresses through a state machine:

```
                    ┌──────────┐
                    │ DETECTED │  Trigger received (webhook, email, manual)
                    └────┬─────┘
                         │
                         ▼
                  ┌──────────────┐
                  │  GATHERING   │  Fetching client, employee pool, history
                  └──────┬───────┘
                         │
                         ▼
                  ┌──────────────┐
                  │   SCORING    │  Running 5-dimension scoring engine
                  └──────┬───────┘
                         │
                         ▼
                  ┌──────────────┐
                  │  REASONING   │  LLM evaluating scored candidates
                  └──────┬───────┘
                         │
                    ┌────┴────┐
                    ▼         ▼
            ┌───────────┐  ┌───────────┐
            │ CONTACTING │  │ ESCALATED │  LLM determined human needed
            └─────┬─────┘  └───────────┘
                  │
            ┌─────┴──────────┐
            ▼                ▼
    ┌──────────────┐  ┌──────────────┐
    │   ACCEPTED   │  │  NO_RESPONSE │  Expiry hit, try next candidate
    └──────┬───────┘  └──────┬───────┘
           │                 │
           ▼                 ▼
    ┌──────────────┐  ┌──────────────┐
    │   ASSIGNED   │  │  CASCADING   │  Move to next ranked candidate
    └──────┬───────┘  └──────┬───────┘
           │                 │
           ▼            (loops back to CONTACTING
    ┌──────────────┐    or ESCALATED after N attempts)
    │  COMPLETED   │
    └──────────────┘
```

### Task Record

Every shift-filling attempt is persisted as a `RosterTask`:

```typescript
/** Persistent record of a shift-filling workflow */
export interface RosterTask {
  id: string;                                    // UUID
  visit_id: number;                              // AlayaCare visit being filled
  client_id: number;
  status: RosterTaskStatus;
  urgency: "planned" | "urgent";                 // <4hrs to shift = urgent

  // Scoring
  match_result: MatchResult | null;              // From scoring engine
  weights_used: WeightConfig | null;

  // LLM reasoning
  llm_recommendation: LLMRecommendation | null;  // From reasoning layer

  // Contact tracking
  contacts: ContactAttempt[];                     // Ordered list of outreach attempts
  current_contact_index: number;
  cascade_strategy: "sequential" | "parallel";

  // Outcome
  assigned_employee_id: number | null;
  escalated_to: string | null;                   // User ID of human who took over
  escalation_reason: string | null;

  // Timing
  detected_at: string;                           // ISO timestamp
  scoring_completed_at: string | null;
  first_contact_at: string | null;
  resolved_at: string | null;                    // Assigned or escalated
  time_to_fill_ms: number | null;

  // Audit
  created_by: "system" | "manual";               // Webhook trigger vs human-initiated
  audit_log: AuditEntry[];                       // Every action with timestamp + reasoning
}

export type RosterTaskStatus =
  | "detected"
  | "gathering"
  | "scoring"
  | "reasoning"
  | "contacting"
  | "cascading"
  | "accepted"
  | "assigned"
  | "escalated"
  | "completed"
  | "cancelled";
```

### Contact Attempt Tracking

```typescript
/** Record of outreach to a single caregiver */
export interface ContactAttempt {
  employee_id: number;
  employee_name: string;
  rank: number;                                  // Position in scored list
  overall_score: number;

  // Communication
  channel: "sms" | "email";                       // "app_notification" deferred to Phase 2
  sent_at: string;
  expires_at: string;                            // 2hrs planned, 20min urgent

  // Response
  response: "pending" | "accepted" | "declined" | "expired";
  responded_at: string | null;
  decline_reason: string | null;

  // LLM reasoning for why this caregiver was selected
  selection_reason: string;
}
```

### Audit Trail

```typescript
/** Immutable log entry for every action in a roster task */
export interface AuditEntry {
  timestamp: string;
  action: string;                                // e.g. "scoring_completed", "sms_sent", "offer_declined"
  actor: "system" | "llm" | string;              // "system", "llm", or user ID
  details: Record<string, unknown>;              // Action-specific data
  reasoning?: string;                            // LLM reasoning if applicable
}
```

### File Structure

```
src/
  services/
    rostering/
      types.ts                    # RosterTask, ContactAttempt, AuditEntry, enums
      roster-task-service.ts      # CRUD for roster tasks (DB persistence)
      workflow-orchestrator.ts     # State machine: coordinates scoring → LLM → comms → assignment
      trigger-detector.ts         # Identifies new shifts needing filling (webhook + polling)
      urgency-classifier.ts       # Determines planned vs urgent based on time-to-shift
      cascade-engine.ts           # Manages sequential/parallel contact strategies
      index.ts                    # Barrel export
```

### Orchestrator Design

The orchestrator is an **async pipeline**, not a long-running process. Each state transition is a discrete function call that updates the task record and schedules the next step.

```typescript
/** Main orchestration pipeline — called when a task needs to advance */
export async function advanceTask(taskId: string): Promise<RosterTask> {
  const task = await getTask(taskId);

  switch (task.status) {
    case "detected":
      return gatherContext(task);        // Fetch client + employee pool
    case "gathering":
      return scoreCandidate(task);       // Run scoring engine
    case "scoring":
      return reasonAboutMatch(task);     // LLM evaluation
    case "reasoning":
      return initiateContact(task);      // Send first notification (or escalate)
    case "contacting":
      return handleResponse(task);       // Process accept/decline/timeout
    case "cascading":
      return contactNext(task);          // Move to next candidate
    case "accepted":
      return assignInAlayaCare(task);    // Write assignment back to AlayaCare
    default:
      return task;                       // Terminal state
  }
}
```

**Why not a long-running process:** Next.js serverless functions have execution time limits. The orchestrator advances one step per invocation, persists state to the database, and the next step is triggered by either a webhook callback (SMS response), a scheduled poll, or a timeout timer.

### Urgency Classification

```typescript
export function classifyUrgency(visit: Visit): "planned" | "urgent" {
  const shiftStart = new Date(visit.start_at);
  const now = new Date();
  const hoursUntilShift = (shiftStart.getTime() - now.getTime()) / (1000 * 60 * 60);

  // Urgent: <4 hours to shift start, or flagged by care manager
  if (hoursUntilShift < 4) return "urgent";
  if (visit.service_instructions?.includes("URGENT")) return "urgent";
  return "planned";
}
```

Urgency determines:
- **Weight preset:** Urgent → `efficiency_heavy` (proximity + acceptance), Planned → `continuity_heavy` (relationship)
- **Cascade strategy:** Urgent → parallel (top 5 simultaneously), Planned → sequential
- **Expiry window:** Urgent → 20 minutes, Planned → 2 hours
- **Escalation threshold:** Urgent → 15 minutes with no response, Planned → after top 10 contacts exhausted

---

## 2. LLM Reasoning Layer

Takes scored caregiver rankings from the scoring engine and applies contextual reasoning, trade-off analysis, and escalation decisions.

### Separation from Scoring

```
Scoring Engine (PoC 1)           LLM Reasoning (Phase 1)
──────────────────────           ────────────────────────
Deterministic numbers            Contextual interpretation
"Skills: 0.9, Proximity: 0.85"  "Sarah is best despite longer commute because
                                  she has 10 prior visits and client prefers continuity"
Always same output               May vary with context
<50ms                            ~1-3s per call
No cost per call                 Token cost per call
```

### LLM Recommendation Type

```typescript
export interface LLMRecommendation {
  /** Top recommended caregiver with explanation */
  primary: {
    employee_id: number;
    employee_name: string;
    explanation: string;              // Natural language: "Sarah recommended because..."
    confidence: "high" | "medium" | "low";
  };

  /** Whether this scenario should be escalated to a human */
  escalation: {
    should_escalate: boolean;
    reason: string | null;            // Why escalation is needed
    urgency: "immediate" | "before_shift" | "informational";
  };

  /** Factors the LLM considered */
  factors_considered: string[];       // e.g. ["Client prefers female caregivers", "Evening shift"]

  /** Trade-offs identified */
  trade_offs: string[];               // e.g. ["Higher skilled but further away"]

  /** LLM usage metadata */
  model: string;
  usage: { inputTokens: number; outputTokens: number };
}
```

### Prompt Architecture

The LLM receives a structured prompt with three sections:

```
┌─────────────────────────────────────────────┐
│  SYSTEM PROMPT (static)                      │
│  Role definition, output format, escalation  │
│  criteria, decision guidelines               │
├─────────────────────────────────────────────┤
│  CONTEXT (per-request)                       │
│  Visit details, client info, constraints     │
├─────────────────────────────────────────────┤
│  SCORED CANDIDATES (from scoring engine)     │
│  Top N candidates with dimension breakdown   │
│  and human-readable reason strings           │
└─────────────────────────────────────────────┘
```

#### System Prompt

```typescript
export const ROSTERING_SYSTEM_PROMPT = `You are a rostering assistant for an aged care provider.
You receive scored caregiver rankings and must:

1. RECOMMEND the best caregiver with a clear explanation
2. IDENTIFY if this scenario requires human escalation
3. EXPLAIN your reasoning including trade-offs

ESCALATION CRITERIA — escalate when ANY of these apply:
- No candidate scores above 0.5 overall confidence
- Top candidate has "low" confidence on skills dimension
- Compliance concern (expired qualifications needed for this shift)
- Conflicting information between data sources
- Fewer than 3 viable candidates
- Client is flagged as high-priority and top candidate has no prior relationship
- You are uncertain about the right choice

OUTPUT FORMAT (JSON):
{
  "primary": {
    "employee_id": <number>,
    "employee_name": "<string>",
    "explanation": "<1-2 sentence natural language explanation>",
    "confidence": "high|medium|low"
  },
  "escalation": {
    "should_escalate": <boolean>,
    "reason": "<string or null>",
    "urgency": "immediate|before_shift|informational"
  },
  "factors_considered": ["<factor1>", "<factor2>"],
  "trade_offs": ["<trade-off1>", "<trade-off2>"]
}`;
```

#### Context Template

```typescript
export function buildReasoningPrompt(
  visit: Visit,
  client: AlayaClient,
  matchResult: MatchResult,
  taskContext: { urgency: "planned" | "urgent" }
): string {
  const candidateList = matchResult.candidates
    .map((c, i) => formatCandidate(c, i + 1))
    .join("\n\n");

  return `## Shift Details
- Visit ID: ${visit.id}
- Date/Time: ${visit.start_at} to ${visit.end_at}
- Status: ${visit.status}
- Urgency: ${taskContext.urgency}
- Instructions: ${visit.service_instructions || "None"}

## Client
- Name: ${client.first_name} ${client.last_name}
- Location: ${client.city}, ${client.state}
- Care Needs: ${client.care_needs || "Not specified"}

## Data Quality Warnings
${matchResult.data_warnings.length > 0
  ? matchResult.data_warnings.map(w => `- ${w}`).join("\n")
  : "- None"}

## Scored Candidates (${matchResult.candidates.length} of ${matchResult.candidate_pool_size} employees)
Weights used: ${formatWeights(matchResult.weights_used)}

${candidateList}

Based on the above, provide your recommendation.`;
}
```

### File Structure

```
src/
  services/
    reasoning/
      types.ts                    # LLMRecommendation, prompt types
      prompts.ts                  # System prompt, context template builder
      reasoning-service.ts        # Calls Bedrock, parses structured output
      parse-response.ts           # JSON extraction + validation from LLM output
      index.ts                    # Barrel export
```

### Integration with Existing Bedrock Client

The reasoning service wraps the existing `generateText()` from `src/lib/llm/bedrock-client.ts`:

```typescript
export async function getRecommendation(
  visit: Visit,
  client: AlayaClient,
  matchResult: MatchResult,
  context: { urgency: "planned" | "urgent" }
): Promise<LLMRecommendation> {
  const prompt = buildReasoningPrompt(visit, client, matchResult, context);

  const result = await generateText({
    system: ROSTERING_SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.3,          // Low temperature for consistent decisions
    maxTokens: 1024,
  });

  return parseRecommendation(result.text, result.usage);
}
```

**Temperature: 0.3** — lower than the default 0.7. Rostering decisions should be consistent; we don't want creative variation in caregiver recommendations.

### Escalation Decision Flow

```
LLM returns recommendation
         │
         ├── should_escalate: false
         │   └── Proceed to CONTACTING state
         │       (contact recommended caregiver)
         │
         └── should_escalate: true
             │
             ├── urgency: "immediate"
             │   └── Skip to ESCALATED state
             │       (human must act now)
             │
             ├── urgency: "before_shift"
             │   └── Proceed to CONTACTING with flag
             │       (try contact, but alert human)
             │
             └── urgency: "informational"
                 └── Proceed to CONTACTING
                     (log escalation note for review)
```

---

## 3. Communication Layer

Multi-channel outreach to caregivers with response tracking.

### Channel Architecture

```
┌─────────────────────────────────────────┐
│         Communication Dispatcher         │
│  Selects channel(s) per contact attempt  │
├──────────┬──────────┬───────────────────┤
│   SMS    │  Email   │  App Notification  │
│  Twilio  │ SendGrid │  AlayaCare API     │
│  or SNS  │ or SES   │  (native push)     │
└──────────┴──────────┴───────────────────┘
         │            │            │
         ▼            ▼            ▼
┌─────────────────────────────────────────┐
│         Response Handler                 │
│  Webhook receivers for each channel      │
│  Updates ContactAttempt + advances task   │
└─────────────────────────────────────────┘
```

### SMS Flow

```
1. Dispatcher sends SMS via provider (Twilio/SNS)
   Template: "Hi {name}, shift available: {client} on {date} {time}.
              Reply YES to accept or NO to decline."

2. Caregiver replies

3. Webhook receives reply
   → LLM parses conversational response (not just YES/NO)
   → Maps to accept/decline/question
   → If question: LLM generates follow-up, continues conversation
   → If accept: Update task → ACCEPTED → assign in AlayaCare
   → If decline: Log reason → advance to next candidate

4. If no reply within expiry window
   → Mark as expired → advance to next candidate (CASCADING)
```

### Cascade Strategies

**Sequential (planned shifts):**
```
Contact #1 (top ranked) ──[wait 2hrs]──► Contact #2 ──[wait 2hrs]──► Contact #3 ...
```
One at a time to avoid over-offering. Each contact gets the full expiry window.

**Parallel (urgent shifts):**
```
Contact #1 ──┐
Contact #2 ──┤
Contact #3 ──┼── First to accept wins ──► Cancel others ──► Assign
Contact #4 ──┤
Contact #5 ──┘
                 [if none after 15min] ──► ESCALATE to human
```
Top 5 contacted simultaneously. First acceptance wins; others notified immediately.

### Email Integration

**Inbound (trigger source):**
```
Email inbox (dappaai@dovida.com.au)
  → Polling or webhook
  → LLM parses free-text email
  → Extracts: shift details, client, urgency, requirements
  → Creates confirmation email with parsed details
  → On human confirmation → creates RosterTask
```

**Outbound (reporting):**
- Daily summary: shifts filled, escalations, open items
- Weekly report: fill rates, time-to-fill trends, acceptance rates

### File Structure

```
src/
  services/
    communication/
      types.ts                    # Channel types, message templates, response types
      dispatcher.ts               # Route messages to correct channel
      sms-provider.ts             # Twilio/SNS integration (interface + mock, verifyWebhook on provider)
      email-provider.ts           # SES integration (interface + mock)
      email-parser.ts             # Inbound email parsing (extract accept/decline intent)
      response-handler.ts         # Process inbound responses (LLM-parsed + keyword fallback)
      templates.ts                # Message templates (shift offer, confirmation, cancellation)
      index.ts
      # Note: cascade-engine.ts lives in rostering/ (workflow concern, not communication)
      # Note: webhook verification is on SMSProvider.verifyWebhook() — provider-specific

app/
  api/v1/
    webhooks/
      sms/route.ts                # Inbound SMS webhook (Twilio/SNS)
      email/route.ts              # Inbound email webhook
```

### Provider Abstraction

Communication providers are behind interfaces so they can be swapped (e.g., Twilio → SNS):

```typescript
export interface SMSProvider {
  send(to: string, body: string): Promise<{ messageId: string }>;
}

export interface EmailProvider {
  send(options: {
    to: string;
    subject: string;
    body: string;
    html?: string;
  }): Promise<{ messageId: string }>;
}
```

---

## 4. AlayaCare Integration Enhancements

Phase 1 extends the existing proxy pattern with webhooks, write-back, and data validation.

### Webhooks (P1.7)

```
AlayaCare ──webhook──► POST /api/v1/webhooks/alayacare
                              │
                              ├── Event: new_visit (status=vacant)
                              │   └── Create RosterTask → start orchestrator
                              │
                              ├── Event: visit_cancelled
                              │   └── Cancel active RosterTask → notify contacted caregivers
                              │
                              ├── Event: visit_modified
                              │   └── Re-score if material change → update contacts
                              │
                              ├── Event: employee_availability_changed
                              │   └── Re-score affected active tasks
                              │
                              └── Event: clock_in / clock_out
                                  └── Update task status → log outcome
```

**Webhook verification:** AlayaCare webhook signature validation on all inbound events.

### Write-Back Operations

When a caregiver accepts:

```typescript
async function assignInAlayaCare(task: RosterTask): Promise<void> {
  // 1. Create offer in AlayaCare
  await alayaFetch(`/scheduler/visits/${task.visit_id}/offers`, {
    method: "POST",
    body: { employee_id: task.assigned_employee_id },
  });

  // 2. Update visit status if needed
  // (AlayaCare may handle this automatically when offer is accepted)

  // 3. Log audit entry
  task.audit_log.push({
    timestamp: new Date().toISOString(),
    action: "assigned_in_alayacare",
    actor: "system",
    details: {
      employee_id: task.assigned_employee_id,
      visit_id: task.visit_id,
    },
  });
}
```

### Data Validation (P1.8, P1.9)

Pre-flight checks before scoring:

```typescript
export interface DataValidationResult {
  valid: boolean;
  warnings: string[];
  blockers: string[];            // Issues that prevent scoring
}

export function validateMatchInputs(
  visit: Visit,
  client: AlayaClient,
  employees: Employee[]
): DataValidationResult {
  const warnings: string[] = [];
  const blockers: string[] = [];

  // Client checks
  if (!client.latitude || !client.longitude) {
    warnings.push("Client missing coordinates — proximity scoring unavailable");
  }

  // Visit checks
  if (!visit.client_id) {
    blockers.push("Visit has no client_id — cannot score");
  }
  if (new Date(visit.start_at) < new Date()) {
    warnings.push("Visit start time is in the past");
  }

  // Employee pool checks
  const withCoords = employees.filter(e => e.latitude && e.longitude).length;
  if (withCoords < employees.length * 0.5) {
    warnings.push(`${employees.length - withCoords} of ${employees.length} employees missing coordinates`);
  }
  if (employees.length === 0) {
    blockers.push("No active employees in pool");
  }

  return { valid: blockers.length === 0, warnings, blockers };
}
```

When blockers exist → skip scoring, escalate immediately with validation report.
When warnings exist → score with available data, attach warnings to `MatchResult`.

---

## 5. Human-in-the-Loop Interface

### 5.1 Operations Dashboard (P1.17)

Extends the existing dashboard with a live activity feed.

```
┌─────────────────────────────────────────────────────────────┐
│  Dashboard                                                   │
├──────────────────┬──────────────────────────────────────────┤
│  Metrics (existing)  │  Live Activity Feed (new)             │
│  ┌────┐ ┌────┐      │  ┌─────────────────────────────────┐  │
│  │Vis │ │Unf │      │  │ 09:14 Task #47 — CONTACTING     │  │
│  │its │ │illed│     │  │ SMS sent to Sarah Chen           │  │
│  └────┘ └────┘      │  ├─────────────────────────────────┤  │
│  ┌────┐ ┌────┐      │  │ 09:12 Task #46 — ASSIGNED ✓     │  │
│  │Emp │ │Cli │      │  │ James Park accepted via SMS      │  │
│  └────┘ └────┘      │  ├─────────────────────────────────┤  │
│                      │  │ 09:10 Task #45 — ESCALATED ⚠    │  │
│  Time-to-fill avg    │  │ No qualified caregivers nearby   │  │
│  Fill rate today     │  │ [Take Over]                      │  │
│  Active tasks        │  └─────────────────────────────────┘  │
└──────────────────┴──────────────────────────────────────────┘
```

**Data source:** Poll `RosterTask` records with status != completed/cancelled, ordered by `detected_at` desc.

### 5.2 Escalation Console (P1.18)

Dedicated page for human intervention on escalated tasks.

```
┌─────────────────────────────────────────────────────────────┐
│  Escalation Queue                          [Urgent] [All]    │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────┐    │
│  │ URGENT │ Visit #1234 — Mrs Smith, Mon 2pm           │    │
│  │ Escalation: "No candidate scores above 0.5"          │    │
│  │                                                       │    │
│  │ LLM Recommendation: Sarah Chen (0.82) — "Best        │    │
│  │ match despite 23km distance; only candidate with      │    │
│  │ Manual Handling certification"                        │    │
│  │                                                       │    │
│  │ Scored Candidates:                                    │    │
│  │  #1 Sarah Chen    0.82 ████████░░ [Assign]            │    │
│  │  #2 James Park    0.71 ███████░░░ [Assign]            │    │
│  │  #3 Lisa Wang     0.65 ██████░░░░ [Assign]            │    │
│  │                                                       │    │
│  │ Contact History:                                      │    │
│  │  Sarah Chen — SMS sent 09:14, awaiting response       │    │
│  │                                                       │    │
│  │ [Accept Recommendation] [Assign Manually] [Defer]     │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

**Actions:**
- **Accept recommendation** — proceed with LLM's pick, task returns to CONTACTING
- **Assign manually** — human selects from scored list, bypass LLM recommendation
- **Defer** — postpone decision, keep in queue
- **Take over** — human assumes full control, task exits autonomous flow

### 5.3 Audit Trail (P1.19)

Searchable log of all agent actions.

```typescript
// Query interface
export interface AuditQuery {
  task_id?: string;
  visit_id?: number;
  employee_id?: number;
  action?: string;
  actor?: string;
  from_date?: string;
  to_date?: string;
}
```

Each audit entry links back to the `RosterTask` and includes:
- What happened (action)
- Who did it (system/LLM/human user ID)
- Why (reasoning string from LLM, or "manual override" for humans)
- Full scoring data at the time of decision

### 5.4 Analytics Dashboard (P1.20)

30-day rolling metrics:

| Metric | Source |
|--------|--------|
| Autonomous fill rate | `RosterTask` records where `escalated_to` is null |
| Average time-to-fill | `resolved_at - detected_at` for completed tasks |
| First-contact acceptance rate | `contacts[0].response === "accepted"` / total tasks |
| Escalation rate | Tasks with `status === "escalated"` / total tasks |
| Fill rate by shift type | Group by urgency, time of day, client |
| Agent vs human performance | Compare fill time for autonomous vs escalated tasks |

### 5.5 Conversational Interface (P1.21)

Chat-based queries that execute against the rostering system:

```
User: "Is Sarah available Thursday?"
  → LLM extracts: employee=Sarah, date=Thursday
  → Query AlayaCare visits for Sarah on Thursday
  → Return: "Sarah has a shift 9am-12pm with Client X. She's free from 1pm."

User: "Find an urgent carer for a shift in Epping tomorrow at 2pm"
  → LLM extracts: urgency=urgent, location=Epping, date=tomorrow, time=2pm
  → Create RosterTask with manual trigger
  → Run scoring + reasoning pipeline
  → Return: "I've found 3 candidates. Top match: James Park (0.85). Shall I contact him?"

User: "Assign Tom to Friday shift"
  → LLM extracts: employee=Tom, date=Friday
  → Resolve employee and visit from context
  → Create offer in AlayaCare
  → Return: "Done. Tom has been assigned to Visit #1234 (Friday 9am-1pm, Mrs Smith)."
```

**Architecture:** Extends the existing chat infrastructure (`src/lib/llm/`, `src/lib/sse.ts`) with rostering-specific tool use. The LLM receives available "tools" (query availability, create task, assign caregiver) and calls them based on user intent.

### UI File Structure

```
app/
  (app)/
    dashboard/page.tsx            # Enhanced with live activity feed
    roster/                       # New — rostering operations
      page.tsx                    # Active roster tasks list
      [id]/page.tsx               # Task detail + audit trail
    escalations/page.tsx          # Escalation queue
    analytics/page.tsx            # 30-day metrics dashboard
    chat/page.tsx                 # Conversational interface (reinstated)

components/
  rostering/
    activity-feed.tsx             # Live task activity stream
    task-card.tsx                 # Roster task summary card
    task-detail.tsx               # Full task view with audit trail
    escalation-card.tsx           # Escalation queue item
    candidate-list.tsx            # Scored candidates with assign actions
    score-bar.tsx                 # Visual score indicator (████░░)
    audit-timeline.tsx            # Chronological audit entry display
    analytics-charts.tsx          # 30-day metric visualisations
```

---

## 6. Database Schema (New Tables)

Phase 1 requires local persistence for task state, audit logging, and analytics. These are **internal tables** (not AlayaCare data).

```sql
-- Roster task tracking
CREATE TABLE roster_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),          -- Tenant isolation
  visit_id INTEGER NOT NULL,                            -- AlayaCare visit ID
  client_id INTEGER,
  status TEXT NOT NULL DEFAULT 'detected',
  urgency TEXT NOT NULL DEFAULT 'planned',

  match_result JSONB,                                   -- Full MatchResult snapshot
  llm_recommendation JSONB,                             -- Full LLMRecommendation
  contacts JSONB NOT NULL DEFAULT '[]',                 -- ContactAttempt[]
  current_contact_index INTEGER NOT NULL DEFAULT 0,
  cascade_strategy TEXT NOT NULL DEFAULT 'sequential',

  assigned_employee_id INTEGER,
  escalated_to UUID REFERENCES users(id),
  escalation_reason TEXT,

  detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  scoring_completed_at TIMESTAMPTZ,
  first_contact_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  time_to_fill_ms INTEGER,

  created_by TEXT NOT NULL DEFAULT 'system',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Audit log (append-only)
CREATE TABLE roster_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES roster_tasks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),           -- Tenant isolation
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  action TEXT NOT NULL,
  actor TEXT NOT NULL,                                   -- 'system', 'llm', or user ID
  details JSONB NOT NULL DEFAULT '{}',
  reasoning TEXT
);

-- Analytics (materialised from roster_tasks, refreshed periodically)
CREATE TABLE roster_daily_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  date DATE NOT NULL,
  tasks_created INTEGER NOT NULL DEFAULT 0,
  tasks_filled_autonomous INTEGER NOT NULL DEFAULT 0,
  tasks_escalated INTEGER NOT NULL DEFAULT 0,
  avg_time_to_fill_ms INTEGER,
  first_contact_acceptance_rate NUMERIC(5,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, date)
);

-- RLS policies (same pattern as existing tables)
ALTER TABLE roster_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE roster_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE roster_daily_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY roster_tasks_isolation ON roster_tasks
  FOR ALL USING (user_id = auth.uid());
CREATE POLICY roster_audit_isolation ON roster_audit_log
  FOR ALL USING (user_id = auth.uid());
CREATE POLICY roster_metrics_isolation ON roster_daily_metrics
  FOR ALL USING (user_id = auth.uid());
```

---

## 7. API Routes (New)

| Method | Route | Purpose |
|--------|-------|---------|
| POST | `/api/v1/roster/tasks` | Create roster task (manual trigger) |
| GET | `/api/v1/roster/tasks` | List active tasks (filterable by status) |
| GET | `/api/v1/roster/tasks/[id]` | Task detail with full audit trail |
| PATCH | `/api/v1/roster/tasks/[id]` | Human actions (accept, assign, defer, take over, cancel) |
| GET | `/api/v1/roster/escalations` | Escalated tasks queue |
| GET | `/api/v1/roster/analytics` | 30-day metrics |
| GET | `/api/v1/roster/audit` | Searchable audit log |
| POST | `/api/v1/webhooks/alayacare` | AlayaCare event webhook receiver |
| POST | `/api/v1/webhooks/sms` | Inbound SMS webhook |
| POST | `/api/v1/webhooks/email` | Inbound email webhook |

All routes follow the existing pattern: `traceId → requireAuthContext → makeDeps() → handler → Response.json()`.

Webhook routes use `requireAuthContext` for internal routes, but webhook signature verification (not user auth) for external webhooks from AlayaCare/Twilio.

---

## 8. Learning & Continuous Improvement (P1.16)

### Outcome Tracking

Every completed `RosterTask` records:
- Caregivers contacted and their responses
- Time to fill
- Whether human intervention was required
- Post-assignment outcomes (if available via AlayaCare: attendance, incidents)

### Pattern Recognition (Periodic Analysis)

Scheduled job (daily or weekly) analyses completed tasks to surface:

| Pattern | Detection Method | Action |
|---------|-----------------|--------|
| Caregiver always declines evening shifts | Decline rate by shift time bucket per employee | Reduce acceptance score for evening shifts |
| Caregiver marked available but never accepts | Available in AlayaCare but 0% acceptance rate | Flag anomaly to human team |
| Certain weight preset consistently outperforms | Compare fill rate across presets | Recommend default preset change |
| Client has high caregiver churn | Unique caregivers / total visits ratio | Flag for continuity-heavy weighting |

### Feedback Loop to Scoring

Over time, the acceptance likelihood scorer (PoC 1) can be refined with real outcome data:

```
Initial: score based on AlayaCare historical offers
  ↓
Phase 1: supplement with DappaAi's own contact attempt outcomes
  ↓
Future: weight recent DappaAi data higher than older AlayaCare data
```

---

## Key Architectural Decisions

| ID | Decision | Rationale |
|----|----------|-----------|
| P1 | **Async pipeline, not long-running process** | Next.js serverless constraints; state persisted to DB between steps; webhooks/polls trigger advancement |
| P2 | **LLM for reasoning, not scoring** | Scoring is deterministic math; LLM adds contextual interpretation, escalation judgement, and natural language explanations |
| P3 | **Provider-abstracted communication** | SMS (Twilio/SNS) and email (SendGrid/SES) behind interfaces; swappable without workflow changes |
| P4 | **Append-only audit log** | Separate table from task record; never modified; supports compliance and transparency requirements |
| P5 | **JSONB for flexible data** | `match_result`, `llm_recommendation`, `contacts` stored as JSONB — schema evolves without migrations during rapid PoC iteration |
| P6 | **Urgency drives strategy** | Single classification (planned/urgent) determines weight preset, cascade mode, expiry window, and escalation threshold |
| P7 | **Webhook-first, polling-fallback** | AlayaCare webhooks for real-time triggers; polling as fallback if webhooks unavailable or unreliable |
| P8 | **Local DB for task state, AlayaCare for entity data** | RosterTask lifecycle is ours; caregiver/client/visit data stays in AlayaCare (source of truth) |

---

## Dependencies & Prerequisites

| Dependency | Required For | Status |
|-----------|-------------|--------|
| PoC 1 scoring engine | Scoring step in orchestrator | Architecture designed, not yet implemented |
| PoC 2 LLM validation | Reasoning prompts and escalation criteria | Not started |
| SMS provider account (Twilio or AWS SNS) | SMS notifications | Not set up |
| Email provider account (SendGrid or AWS SES) | Email parsing and sending | Not set up |
| AlayaCare webhook access | Real-time trigger detection | Not available (sandbox pending) |
| Database migration for new tables | Task persistence and audit logging | Not created |

---

## Implementation Priority

Phase 1 is a 4-month build (weeks 9–24). Suggested ordering:

| Priority | Feature Area | Depends On |
|----------|-------------|-----------|
| 1 | Workflow orchestrator + task persistence | PoC 1 + PoC 2 complete |
| 2 | LLM reasoning service (wraps PoC 2 prompts) | PoC 2 prompts validated |
| 3 | SMS communication + response handling | SMS provider account |
| 4 | Escalation console UI | Orchestrator + task persistence |
| 5 | Cascade engine (sequential + parallel) | Communication layer |
| 6 | Operations dashboard (live feed) | Task persistence |
| 7 | AlayaCare webhooks | Sandbox access |
| 8 | Email integration (inbound parsing) | Email provider account |
| 9 | Audit trail UI | Audit log table |
| 10 | Analytics dashboard | Enough completed tasks for meaningful data |
| 11 | Conversational interface | All above stable |
| 12 | Learning + pattern recognition | Accumulated outcome data |
