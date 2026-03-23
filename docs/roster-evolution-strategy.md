# Roster Architecture — Evolution Strategy

Analysis of roster management approaches and phased evolution path for autonomous shift-filling.

**Reference documents:**
- Phase 1 architecture: `docs/phase1-rostering-architecture.md`
- Delivery plan: `docs/plans/poc-delivery-plan.md`
- Requirements: `docs/poc.txt`

---

## Context

Phase 1 needs to fill unfilled shifts autonomously. The question: how should we model the "roster" — the current state of who is allocated to which shift?

Four approaches were evaluated against Phase 1 constraints:
- **Serverless execution** (Vercel Functions, no long-running processes)
- **AlayaCare is source of truth** (we don't own the schedule data)
- **Single-tenant, single-user** (no multi-user concurrency yet)
- **MVP scope** (prove value fast, iterate later)

---

## Approaches Evaluated

### Approach A: Task-per-Shift (Current Phase 1 Design)

Each unfilled shift becomes an independent `RosterTask` that progresses through a state machine (`pending_review` → `contacting_carers` → `filled` / `escalated`). No global roster object — each task is self-contained.

```
Unfilled shift → RosterTask → State machine → Outcome (filled/escalated)
                  (independent)
```

**Pros:**
- Simple mental model — one shift, one workflow
- Natural fit for serverless (each transition = one invocation)
- Easy to reason about, debug, and audit per-shift
- No cross-shift coordination needed in MVP
- AlayaCare remains sole source of truth for schedule

**Cons:**
- No awareness of system-wide allocation state
- Can't detect conflicts (same carer offered two overlapping shifts)
- No global optimisation (e.g., "swap these two carers for better fit")
- Scaling requires bolt-on coordination later

**Best for:** MVP/Phase 1 where proving the core loop matters more than optimisation.

---

### Approach B: Roster-as-State-Machine (Event-Sourced)

A "roster" object represents the complete current allocation state. Every mutating event (new shift, cancellation, carer unavailability) triggers a state transition, producing a new roster version. The underlying database is synchronised after each transition.

```
Event → Roster State Machine → New Roster Version → Sync to DB
         (global state)          (immutable snapshot)
```

**Pros:**
- Complete system-wide view of allocations
- Full audit trail via event log (every state change recorded)
- Supports complex rules (conflict detection, optimisation, rebalancing)
- Undo/replay capability via event replay
- Clean separation of "what happened" from "current state"

**Cons:**
- **Scale mismatch**: Global state object for a system initially handling ~5-10 concurrent shifts is over-engineered
- **Two-way sync problem**: AlayaCare owns the schedule — we'd need to keep our roster in sync with their changes AND push our changes back, creating a distributed consistency challenge
- **Conflict resolution complexity**: Two simultaneous events modifying the roster need serialisation or merge strategies
- **Event ordering**: In serverless (no persistent process), guaranteeing event ordering requires infrastructure (queues, sequence numbers)
- **Bootstrap complexity**: Initial roster state must be materialised from AlayaCare on every cold start or maintained in a separate store

**Best for:** Systems where you own the data and need complex multi-entity coordination with full audit history. Better fit for Phase 3+ when scale justifies the complexity.

---

### Approach C: Hybrid (Task-per-Shift + Periodic Roster Optimisation)

Individual shifts still use task-per-shift for real-time filling. A periodic batch job builds a read-only roster view and runs optimisation passes (conflict detection, rebalancing, pattern recognition).

```
Real-time:  Unfilled shift → RosterTask → Fill independently
Periodic:   All RosterTasks + AlayaCare data → Roster snapshot → Optimise
```

**Pros:**
- Real-time responsiveness for individual shifts
- System-wide optimisation without real-time coordination overhead
- Optimisation is additive — doesn't block core filling loop
- Natural evolution from Approach A (add batch job, keep existing flow)

**Cons:**
- Optimisation results may conflict with in-flight tasks
- Two systems to maintain (real-time + batch)
- Batch window creates lag between detection and action

**Best for:** Phase 3 when data shows optimisation opportunities are being missed by independent task processing.

---

### Approach D: Read-Only Roster View (Materialised Context)

A materialised view of current allocations pulled from AlayaCare, used as **context** for scoring and decision-making. No mutations to the roster — all changes flow through individual RosterTasks back to AlayaCare.

```
AlayaCare API → Materialised roster view (read-only, refreshed periodically)
                     ↓ (used as context)
RosterTask scoring → "Carer X already has 3 shifts today" → Better decisions
```

**Pros:**
- AlayaCare stays sole source of truth (no sync problem)
- Enriches scoring with system-wide context (workload, travel, preferences)
- Simple to implement (periodic API pull → cache/DB table)
- No conflict resolution needed (read-only)
- Natural extension of existing scoring engine

**Cons:**
- View is eventually consistent (stale by refresh interval)
- Can't enforce constraints in real-time (only inform decisions)
- No optimisation actions — still relies on individual task outcomes

**Best for:** Phase 2 when scoring needs context beyond the single shift being filled.

---

## Recommended Evolution Path

```
Phase 1 (MVP)          Phase 2 (Context)         Phase 3 (Optimisation)
─────────────          ─────────────────         ──────────────────────
Approach A:            Approach D:                Approach C:
Task-per-Shift         + Read-Only Roster View    + Periodic Optimisation

• Independent tasks    • Materialised view from   • Batch job builds full
• Simple state machine   AlayaCare (refreshed       roster snapshot
• Prove core loop        every N minutes)         • Conflict detection
• No cross-shift       • Scoring uses roster       • Rebalancing suggestions
  awareness              context for better        • Pattern recognition
                         decisions                 • Human-approved swaps
                       • "Carer has 3 shifts
                         today" → lower score
```

### Phase 1 → Phase 2 Transition Trigger

Move to Phase 2 (add roster view) when:
- Scoring accuracy is limited by lack of workload context
- Carers are being over-offered (no visibility into existing allocations)
- Coordinators report conflicts that the system should have caught

**Implementation:** Add a `roster_snapshot` table (or cache), a periodic AlayaCare sync job, and pass roster context into the scoring engine as additional input.

### Phase 2 → Phase 3 Transition Trigger

Move to Phase 3 (add optimisation) when:
- Data shows measurable missed optimisation opportunities
- Volume justifies batch processing investment
- Coordinators want system-suggested swaps/rebalancing

**Implementation:** Add a batch optimisation job that reads the roster view + active tasks, identifies improvements, and creates coordinator-approved action items.

### Event-Sourced Roster (Approach B) — When It Makes Sense

Approach B remains a valid long-term destination if:
- The system becomes the primary scheduling tool (not just filling gaps in AlayaCare)
- Multi-user real-time collaboration is needed
- Regulatory requirements demand immutable audit trails beyond what task-level logging provides
- Scale reaches hundreds of concurrent roster changes per minute

At that point, the system would need proper event infrastructure (message queues, event store, CQRS read models) which is a significant architectural investment best justified by proven scale requirements.

---

## Decision Record

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-03-11 | Phase 1 uses Approach A (task-per-shift) | Simplest model that proves the core filling loop; serverless-friendly; AlayaCare stays source of truth |
| 2026-03-11 | Defer event-sourced roster (Approach B) | Scale mismatch for MVP; two-way sync with AlayaCare adds unjustified complexity; event ordering in serverless requires infrastructure investment |
| 2026-03-11 | Plan evolution: A → D → C | Each phase adds capability only when data justifies the investment; read-only view (D) before write-side optimisation (C) |
