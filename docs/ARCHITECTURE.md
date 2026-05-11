# Architecture

Formal architecture for the current **Pep Avatar v2** codebase and the target production architecture for a voice-driven, verified-corpus product with editorial authoring workflows.

**Companion documents:**
- [INFRASTRUCTURE.md](./INFRASTRUCTURE.md) — deployment, services, environments, operations.
- [PROCESSING-STREAMS.md](./PROCESSING-STREAMS.md) — current concurrent processing streams.
- [plans/production-modernization-plan.md](./plans/production-modernization-plan.md) — phase-by-phase implementation plan.

---

## 1. Purpose

This document serves two purposes:

1. Describe the architecture that exists in the repository today.
2. Define the target production architecture for the next iteration of the product.

The current codebase is best understood as a **high-quality demo application** with some product foundations already present. The target state is a **production-grade voice product** with:

- low-latency runtime turn orchestration
- a verified and versioned Q&A corpus
- auditable provenance back to source documents
- a client authoring and approval workflow
- clear separation between runtime and editorial workloads

---

## 2. Product Scope

### 2.1 Current scope

The current repository contains two distinct surfaces:

| Surface | Route prefix | Purpose | Current status |
|---|---|---|---|
| Public voice demo | `/demo/screen`, `/api/v1/screen/*`, `/api/v1/demo/tavus/*` | Voice-driven screening and curated Q&A demo | Active |
| Authenticated app shell | `/dashboard`, `/settings`, `/api/v1/user/*` | User profile, sessions, devices, login history | Active but separate from the demo |

The public demo exposes three user modes inside one page:

- **Screening** — a staged stock-filtering funnel over an ASX snapshot
- **Process Q&A** — curated answers about OC's investment process
- **Fund Q&A** — curated answers about specific OC funds

### 2.2 Target scope

The production product expands beyond the demo into two planes:

| Plane | Users | Purpose |
|---|---|---|
| **Runtime plane** | end users / investors | answer live voice turns quickly and safely from an approved corpus |
| **Authoring plane** | admins, editors, reviewers, publishers | upload documents, generate drafts, curate Q&A, publish corpus versions |

The runtime plane must be optimized for **latency, determinism, and correctness**. The authoring plane must be optimized for **traceability, editorial control, and versioning**. These planes share data, but must not share hot-path execution.

---

## 3. Architecture Summary

### 3.1 Current architecture

Today, the public voice flow is a **client-orchestrated demo**:

1. Browser captures audio.
2. Browser sends audio or text to `POST /api/v1/screen/process`.
3. Server returns `{ text, intent }`.
4. Browser decides what to do next:
   - apply a filter
   - look up a stock fact
   - compute holdings overlap
   - fetch a curated answer from local JSON
   - gate or reject the request
5. Browser assembles narration text and sends it to Tavus.

This is intentionally lightweight, but it means a large amount of product logic currently lives in the browser.

### 3.2 Target architecture

The production product should move to a **server-orchestrated runtime**:

1. Browser captures audio.
2. Browser sends one turn request to a runtime endpoint.
3. Server transcribes, classifies, resolves context, selects the approved answer or action, and composes the final narration payload.
4. Browser renders UI state and forwards the returned narration text to Tavus.

That architecture collapses multi-step client orchestration into a single server-owned turn contract.

---

## 4. Current System (As Implemented)

### 4.1 Public demo data flow

```
Microphone
  -> client VAD / PCM capture
  -> POST /api/v1/screen/process
      -> ElevenLabs STT
      -> rule-first intent matching
      -> Anthropic fallback classification
      -> entity resolution
  -> browser dispatcher
      -> optional /api/v1/screen/apply-filter
      -> optional /api/v1/screen/stock-fact
      -> optional /api/v1/screen/portfolio-overlap
      -> optional local curated-answer lookup
  -> narration assembly in browser
  -> Tavus conversation.echo
```

### 4.2 Current code ownership

The current public-demo logic is split across these modules:

| Area | Primary files | Notes |
|---|---|---|
| UI orchestration | `components/screen/screen-page.tsx` | Large client-side dispatcher and state owner |
| Voice capture | `src/demo/use-voice-listener.ts` | Client-side amplitude VAD |
| Tavus session | `src/demo/use-tavus-avatar.ts` | Client-side Daily/Tavus integration |
| Intent matching | `src/screen/intent-rules.ts`, `src/screen/screen-matcher.ts` | Rule-first matcher plus Anthropic fallback |
| Curated banks | `src/screen/fund-qa.ts`, `src/screen/process-qa.ts` | Static JSON-backed answers |
| Screening engine | `src/screen/funnel.ts`, `src/screen/use-screener.ts` | Pure filter logic plus client hook |
| Snapshot / facts | `src/screen/snapshot-cache.ts`, `src/screen/market-data-provider.ts` | Snapshot-backed lookups |

### 4.3 Current strengths

The current codebase already makes several good architectural choices:

- **Verified answers are curated**, not generated on the fly.
- **Intent resolution is rule-first**, keeping most turns deterministic.
- **Screening logic is pure and reusable**, centered in `src/screen/funnel.ts`.
- **Fund/process Q&A banks are typed and drift-checked**, reducing silent breakage.
- **External spend is constrained**, via route-level rate limiting.
- **Auth surface is already layered**, giving a foundation for future admin workflows.

### 4.4 Current limitations

The current architecture is not yet optimal for production:

- Runtime orchestration is **browser-owned**, not server-owned.
- The primary public workflow is concentrated in a **very large client component**.
- Runtime answer selection is **not a single contract**; it is split across routes, local JSON access, and client branching.
- The curated corpus is **version-controlled JSON**, not a publishable editorial system.
- The system has **no authoring plane** for document upload, draft generation, review, approval, or publishing.
- The runtime plane and admin concerns are **not yet separated**.
- Current integration tests are **environment-coupled** rather than hermetic.

---

## 5. Target Production Architecture

## 5.1 Principles

The target architecture should follow these rules:

1. **Runtime and authoring are separate planes.**
2. **Only approved corpus versions serve end-user turns.**
3. **Runtime never reads raw source documents.**
4. **Runtime never generates final answers with an LLM.**
5. **Slow editorial work is asynchronous.**
6. **Every published answer remains traceable to source documents.**
7. **The browser is a thin runtime client, not the product orchestrator.**

## 5.2 Plane separation

### Runtime plane

Purpose:

- handle live voice turns
- keep latency low
- enforce approved-corpus behavior
- produce Tavus-safe narration text

Core characteristics:

- synchronous
- deterministic where possible
- cached
- auditable
- safe to scale horizontally

### Authoring plane

Purpose:

- upload and version documents
- extract and chunk text
- generate draft Q&A
- review and edit drafts
- approve and publish corpus versions

Core characteristics:

- asynchronous
- editorial
- queue-backed
- versioned
- permissioned

---

## 6. Target Runtime Architecture

### 6.1 Runtime turn contract

The public runtime should converge on a single endpoint:

`POST /api/runtime/turn`

Suggested request shape:

```json
{
  "sessionId": "uuid",
  "mode": "screening | fund_qa | process_qa | general_qa",
  "input": {
    "type": "audio | text",
    "text": "optional string",
    "audio": "optional multipart upload reference"
  },
  "clientContext": {
    "selectedFundId": "optional",
    "selectedTicker": "optional",
    "uiState": {}
  }
}
```

Suggested response shape:

```json
{
  "transcript": "user utterance text",
  "intent": {
    "kind": "..."
  },
  "resolution": {
    "type": "answer | action | clarification | rejection",
    "answerId": "optional",
    "answerText": "optional",
    "citations": [],
    "uiDirectives": [],
    "sessionMutations": {}
  },
  "narration": {
    "text": "final text to speak through Tavus"
  },
  "timing": {
    "sttMs": 0,
    "matchMs": 0,
    "totalMs": 0
  }
}
```

### 6.2 Runtime request lifecycle

The target turn flow is:

1. validate request and session
2. transcribe audio if needed
3. normalize text
4. resolve intent
5. resolve entities and session context
6. match the turn to a published corpus entry or deterministic action
7. apply any factual enrichments
8. compose user-visible UI directives
9. compose Tavus narration text
10. persist turn telemetry
11. return one unified response

### 6.3 Runtime matching strategy

Runtime matching should be layered:

1. deterministic rules
2. published corpus variant matching
3. entity resolution
4. low-latency classifier fallback only when needed
5. explicit clarification or fallback

The LLM may assist classification, but should not author the final answer text served to users.

### 6.4 Runtime session state

The runtime plane should keep lightweight server-side session state such as:

- active mode
- funnel progress
- selected fund
- selected entity / ticker
- previous turn outcome
- pending clarification state

This prevents important conversational state from existing only in the browser.

### 6.5 Runtime caching

Published corpus should be compiled into a runtime artifact and loaded from:

- in-memory cache in the application process
- optionally Redis for multi-instance cache coordination

Runtime must not:

- parse PDFs at request time
- scan raw document chunks at request time
- reconstruct answers from source text at request time

---

## 7. Target Authoring Architecture

### 7.1 Authoring lifecycle

The authoring plane should implement this workflow:

1. Admin uploads a document.
2. System stores an immutable document version.
3. Background jobs extract text and chunk it.
4. Background jobs generate draft Q&A candidates.
5. Editors review, rewrite, merge, reject, and annotate drafts.
6. Reviewers approve entries.
7. Publishers publish a new corpus version.
8. Runtime cache refreshes to the newly published artifact.

### 7.2 Editorial rules

Authoring must support:

- human editing of every draft answer
- provenance from answer to source document section
- review states
- publish / rollback
- audit log of who changed what

### 7.3 Admin roles

The target permission model should distinguish at least:

- `admin`
- `editor`
- `reviewer`
- `publisher`

Publishing should be a stronger permission than drafting or editing.

---

## 8. Target Data Model

### 8.1 Current persisted content

Today, the runtime content lives in three places:

- screening snapshot tables in Postgres
- static `data/fund-qa.json`
- static `data/process-qa.json`

This is appropriate for a demo but not for production authoring.

### 8.2 Target persisted model

Suggested core tables:

#### Authoring / source tables

- `documents`
- `document_versions`
- `document_chunks`
- `draft_qa_entries`
- `editorial_reviews`
- `publish_jobs`

#### Corpus tables

- `corpus_entries`
- `corpus_entry_variants`
- `corpus_entry_sources`
- `corpus_entry_rules`
- `corpus_versions`
- `corpus_version_entries`
- `runtime_artifacts`

#### Runtime / telemetry tables

- `runtime_sessions`
- `runtime_turns`
- `runtime_turn_events`
- `admin_audit_log`

### 8.3 Publish model

Published runtime behavior should be versioned:

- draft content remains editable
- published content becomes an immutable runtime snapshot
- runtime loads only the active published version
- rollback means swapping active version, not editing rows in place

---

## 9. Module Boundaries

The target modular-monolith structure should evolve toward:

```
src/
├── runtime/
│   ├── turn-orchestrator/
│   ├── intent/
│   ├── corpus/
│   ├── session/
│   ├── facts/
│   └── narration/
├── authoring/
│   ├── documents/
│   ├── extraction/
│   ├── draft-generation/
│   ├── editorial/
│   └── publishing/
├── jobs/
├── integrations/
│   ├── tavus/
│   ├── elevenlabs/
│   ├── llm/
│   └── document-processing/
├── platform/
│   ├── auth/
│   ├── permissions/
│   ├── logging/
│   ├── metrics/
│   ├── queues/
│   └── cache/
└── db/
```

This is still a monolith, but with explicit domain boundaries.

---

## 10. Public and Admin API Shape

### 10.1 Runtime APIs

Target runtime endpoints:

- `POST /api/runtime/turn`
- `POST /api/runtime/session`
- `POST /api/runtime/tavus/session`
- `DELETE /api/runtime/tavus/session/:id`
- `GET /api/runtime/bootstrap`

### 10.2 Authoring APIs

Target authoring endpoints:

- `POST /api/admin/documents`
- `POST /api/admin/documents/:id/versions`
- `POST /api/admin/documents/:versionId/extract`
- `POST /api/admin/documents/:versionId/generate-drafts`
- `GET /api/admin/drafts`
- `PATCH /api/admin/drafts/:id`
- `POST /api/admin/drafts/:id/approve`
- `POST /api/admin/corpus/publish`
- `GET /api/admin/corpus/versions`
- `POST /api/admin/corpus/versions/:id/rollback`

---

## 11. Performance and Latency

### 11.1 Current latency profile

Current end-user latency is dominated by:

- VAD silence timeout
- ElevenLabs STT latency
- optional Anthropic fallback latency
- Tavus / TTS playback start time

Local application logic is not the dominant contributor.

### 11.2 Target latency posture

Moving orchestration server-side should not materially hurt latency if:

- published corpus is memory-resident
- deterministic matching stays fast
- LLM fallback remains exceptional
- the browser makes one turn request instead of chaining multiple application requests

### 11.3 Performance rules

For production:

- hot-path corpus lookup must be compiled and cached
- raw documents must never be used at runtime
- draft generation must be asynchronous
- runtime must avoid unnecessary cross-service chatter

---

## 12. Testing Strategy

### 12.1 Current status

The current repository has a useful screening-engine test suite, but some tests are still environment-coupled:

- pure matcher and funnel tests are deterministic
- route/provider tests depend on live DB connectivity when `DATABASE_URL` is present
- current `vitest.config.ts` loads `.env.local`, which can cause local CI-style runs to attempt external DB access

This is acceptable for a demo-era codebase, but not ideal for production engineering.

### 12.2 Target testing strategy

The target system should distinguish:

- pure unit tests
- integration tests with local fixtures / test DB
- contract tests for runtime turn responses
- background-job tests
- admin workflow tests
- smoke tests against deployed environments

The runtime turn contract should become the primary product-level test surface.

---

## 13. Migration Direction

The recommended path is evolutionary, not a rewrite:

1. add a server-owned runtime turn orchestrator
2. move browser dispatch logic behind that contract
3. introduce authoring tables and workflows
4. introduce publishable corpus versions
5. cut runtime over to published artifacts

This preserves the working demo while improving production readiness incrementally.

---

## 14. Decision Record

### Current architectural assessment

The present codebase is a **credible demo foundation** with reusable screening logic, curated answer banks, and viable third-party integrations.

### Target architectural decision

The product will evolve into a **modular monolith with separate runtime and authoring planes**, where:

- runtime is fast, deterministic, and versioned
- authoring is asynchronous, audited, and editorial
- only approved corpus versions reach end users

That is the architectural baseline assumed by the production plan in [plans/production-modernization-plan.md](./plans/production-modernization-plan.md).
