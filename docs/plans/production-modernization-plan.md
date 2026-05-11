# Production Modernization Plan

Phase-by-phase plan for evolving the current **Pep Avatar v2** codebase from a demo-oriented application into a production-quality voice product with a verified, editable corpus and an admin authoring workflow.

**Companion documents:**
- [../ARCHITECTURE.md](../ARCHITECTURE.md)
- [../INFRASTRUCTURE.md](../INFRASTRUCTURE.md)

---

## 1. Goals

This plan is designed to achieve the following outcomes:

- move runtime orchestration from the browser to the server
- preserve low-latency voice response behavior
- introduce a client-editable document and Q&A authoring workflow
- introduce approved, versioned, publishable corpus artifacts
- improve operational safety, testability, and auditability

This is an **incremental modernization plan**, not a rewrite plan.

---

## 2. Guiding Constraints

The implementation should preserve these constraints throughout:

- the existing demo must remain operable during migration
- no production runtime should serve unapproved draft answers
- source-document processing must remain off the hot path
- runtime APIs should become simpler, not more fragmented
- major architectural changes should land behind clear boundaries

---

## 3. Phase Summary

| Phase | Name | Outcome |
|---|---|---|
| 0 | Documentation and guardrails | architecture is explicit and the migration target is agreed |
| 1 | Runtime turn orchestration | one server-owned turn contract exists |
| 2 | Runtime state and client slimming | browser orchestration is reduced materially |
| 3 | Authoring data model | document and corpus editing becomes persistable |
| 4 | Document ingestion and draft generation | admins can upload docs and generate drafts |
| 5 | Editorial workflow and publishing | approved corpus versions can be published safely |
| 6 | Runtime cutover to published corpus | end-user turns serve from published artifacts |
| 7 | Operational hardening | cache, queue, rate limiting, observability, security mature |

---

## 4. Phase 0 — Documentation and Guardrails

### Goal

Align the team on the real current state and the intended target before code changes.

### Scope

- update architecture documentation
- update infrastructure documentation
- define the migration plan
- identify hot-path and authoring-path boundaries

### Deliverables

- updated `docs/ARCHITECTURE.md`
- updated `docs/INFRASTRUCTURE.md`
- this implementation plan

### Exit criteria

- documentation accurately describes current system behavior
- documentation clearly distinguishes current state from target state
- implementation sequencing is agreed

---

## 5. Phase 1 — Runtime Turn Orchestration

### Goal

Introduce a single server-owned runtime contract for public user turns.

### Scope

- add a new runtime endpoint, e.g. `POST /api/runtime/turn`
- implement a server-side turn orchestrator
- keep existing demo routes operational during migration
- move intent resolution, context resolution, answer/action selection, and narration assembly behind one contract

### Key changes

- create `src/runtime/turn-orchestrator/*`
- introduce a unified response payload
- keep current matcher/rules as internal dependencies of the orchestrator
- model UI directives explicitly instead of branching only in the browser

### Likely affected areas

- `app/api/v1/screen/process/route.ts`
- `components/screen/screen-page.tsx`
- `src/screen/*`
- new `src/runtime/*` modules

### Risks

- introducing too much abstraction too early
- accidentally breaking the working voice loop while moving logic

### Mitigations

- initially run the new endpoint in parallel with current behavior
- add contract tests around the new runtime response format

### Exit criteria

- one endpoint can accept a user turn and return:
  - transcript
  - intent
  - resolved answer or action
  - narration text
  - UI directives

---

## 6. Phase 2 — Runtime State and Client Slimming

### Goal

Reduce client-owned orchestration and make the browser a thinner runtime client.

### Scope

- move session/runtime state that matters to the server
- simplify `screen-page.tsx`
- ensure only one active user turn is processed at a time
- tighten Tavus session lifecycle handling

### Key changes

- add lightweight runtime session persistence
- add server-side turn locking / single-flight behavior
- pause user capture based on turn state, not only avatar speaking state
- reduce the browser’s responsibility for dispatch decisions

### Likely affected areas

- `components/screen/screen-page.tsx`
- `src/demo/use-voice-listener.ts`
- `src/demo/use-tavus-avatar.ts`
- new `src/runtime/session/*`

### Risks

- session-state drift during cutover
- complexity around mode/funnel migration

### Exit criteria

- client no longer decides most answer/action behavior locally
- browser primarily:
  - captures input
  - renders transcript and UI
  - plays Tavus narration

---

## 7. Phase 3 — Authoring Data Model

### Goal

Create a durable storage model for documents, drafts, editorial state, and published corpus versions.

### Scope

- add authoring tables
- add corpus tables
- add runtime publish/version tables
- preserve existing demo JSON content during transition

### Key changes

- schema additions for:
  - `documents`
  - `document_versions`
  - `document_chunks`
  - `draft_qa_entries`
  - `corpus_entries`
  - `corpus_entry_variants`
  - `corpus_entry_sources`
  - `corpus_versions`
  - `runtime_artifacts`
- write migrations
- define repository/service boundaries for authoring data access

### Risks

- over-modeling before workflow needs are proven
- making publish/version semantics ambiguous

### Exit criteria

- a document and a curated Q&A entry can be represented durably
- published and unpublished content are separable in the schema

---

## 8. Phase 4 — Document Ingestion and Draft Generation

### Goal

Allow admins to upload documents and generate draft Q&A asynchronously.

### Scope

- document upload flow
- immutable version storage
- extraction and chunking
- draft generation jobs
- admin read surfaces for draft inspection

### Key changes

- add object storage integration
- add a queue and worker substrate
- add extraction jobs
- add draft-Q&A generation jobs
- persist chunk and draft metadata

### Likely affected areas

- new `src/authoring/documents/*`
- new `src/jobs/*`
- `src/integrations/document-processing/*`
- admin APIs under `app/api/admin/*`

### Risks

- variable quality of extraction across document formats
- LLM draft quality being mistaken for publication quality

### Mitigations

- always require human review before publication
- store source references with each draft

### Exit criteria

- admin can upload a document
- system can generate drafts asynchronously
- drafts are visible in the admin workflow

---

## 9. Phase 5 — Editorial Workflow and Publishing

### Goal

Turn draft generation into a controlled editorial system with approvals and published corpus versions.

### Scope

- edit/review/approve workflow
- role-based permissions
- publish action
- rollback action
- audit logging

### Key changes

- add admin UI for:
  - draft editing
  - source inspection
  - approval
  - corpus browsing
  - publish/rollback
- add admin roles and permissions
- compile a published corpus version artifact

### Risks

- permissions too coarse or too permissive
- publishing mutable content accidentally

### Exit criteria

- approved corpus entries can be published into an immutable version
- rollback to a prior version is supported
- all editorial actions are audited

---

## 10. Phase 6 — Runtime Cutover to Published Corpus

### Goal

Serve end-user turns from published corpus artifacts rather than repo JSON or ad hoc browser logic.

### Scope

- build runtime artifact loader
- load published corpus into cache
- route runtime matching through published entries
- preserve deterministic screening/fact actions alongside corpus answers

### Key changes

- add `src/runtime/corpus/*`
- replace local JSON lookups in hot runtime behavior
- introduce cache warm/invalidate behavior on publish

### Risks

- mismatch between editorial content and runtime matcher expectations
- publish invalidation bugs

### Exit criteria

- runtime turn endpoint serves approved/published corpus only
- runtime answer provenance can be surfaced to logs or admin review

---

## 11. Phase 7 — Operational Hardening

### Goal

Raise the platform from pilot readiness to production readiness.

### Scope

- distributed cache and rate limiting
- observability
- queue reliability
- security hardening
- test modernization

### Key changes

- replace in-memory rate limiting for scaled environments
- add Redis-backed cache if needed
- add metrics and traces for runtime turns and jobs
- separate hermetic tests from environment-bound smoke tests
- add admin audit monitoring

### Risks

- infrastructure added without enough operational ownership
- observability after the fact rather than by design

### Exit criteria

- runtime SLIs/SLOs are measurable
- job failures are observable and recoverable
- test strategy supports CI without accidental external dependency coupling

---

## 12. Recommended Sequencing Notes

### What should happen early

- Phase 1 before any major admin build-out
- Phase 2 before large UI polish work
- Phase 3 before authoring UI implementation

### What should not happen too early

- full search/embedding retrieval before the editorial model is stable
- microservice decomposition
- replacing every existing route before the new turn contract proves itself

---

## 13. Acceptance Criteria by Product Capability

### Production runtime is achieved when:

- one public turn endpoint owns the runtime flow
- approved answers are versioned and auditable
- user turns do not depend on raw document parsing
- the browser is not the primary orchestrator

### Production authoring is achieved when:

- admins can upload documents
- drafts can be generated asynchronously
- drafts can be reviewed and edited
- approved entries can be published and rolled back

### Production operations are achieved when:

- the platform exposes useful latency/error metrics
- rate limiting and cache behavior work across instances
- CI does not require accidental live-service reachability for core correctness tests

---

## 14. Immediate Next Steps

The next implementation work should begin with:

1. design the `POST /api/runtime/turn` request/response contract
2. extract current browser dispatch logic into server-side runtime modules
3. define the authoring schema migration set

Those three steps establish the backbone for every later phase without requiring a rewrite.
