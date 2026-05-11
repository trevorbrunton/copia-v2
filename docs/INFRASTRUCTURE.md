# Infrastructure

Infrastructure, environment, deployment, and operational guidance for the current **Pep Avatar v2** codebase and the target production platform.

**Companion documents:**
- [ARCHITECTURE.md](./ARCHITECTURE.md) — current and target system design.
- [PROCESSING-STREAMS.md](./PROCESSING-STREAMS.md) — current background and concurrent flows.
- [plans/production-modernization-plan.md](./plans/production-modernization-plan.md) — phased execution plan.

---

## 1. Infrastructure Overview

The current codebase is deployed as a Next.js application with external API dependencies and a Supabase-backed Postgres database. It is sufficient for a demo or pilot, but the target production product requires a clearer split between:

- **runtime infrastructure** for live voice turns
- **authoring infrastructure** for document ingestion and editorial workflows

The production goal is not immediate microservices. The recommended path is a **modular monolith plus managed infrastructure primitives**:

- Postgres
- object storage
- background jobs / queue
- cache
- observability

---

## 2. Current Service Map

| Service | Current purpose | Current integration point |
|---|---|---|
| **Supabase Postgres** | user/session data and screening snapshot data | `src/db/index.ts`, server routes |
| **Supabase Auth** | authenticated dashboard and settings shell | `src/auth/*`, `src/lib/supabase/*` |
| **Tavus CVI** | streaming avatar session lifecycle | `app/api/v1/demo/tavus/*`, `src/demo/use-tavus-avatar.ts` |
| **Daily.co** | WebRTC transport under Tavus | client-side via `@daily-co/daily-js` |
| **ElevenLabs** | speech-to-text and Tavus-side TTS voice | `src/screen/stt.ts`, Tavus persona config |
| **Anthropic** | fallback intent classification | `src/screen/screen-matcher.ts` |
| **Vercel** (assumed host) | hosting for Next.js application | app/router deployment target |

---

## 3. Current Platform Characteristics

### 3.1 Application host

Current assumptions in the code and docs point to a Vercel-style deployment:

- Next.js App Router
- Node serverless functions
- edge caching for selected GET routes
- environment variables managed at deploy time

Nothing in the application strictly requires Vercel, but the current behavior assumes a serverless Node environment rather than a long-lived custom app server.

### 3.2 Current runtime execution model

The current public runtime path is:

- client-owned VAD and audio buffering
- one server call for STT/classification
- optional additional server calls for filters/facts/overlap
- client-owned narration dispatch to Tavus

That keeps the deployment simple, but it also means browser behavior materially affects correctness.

### 3.3 Current operational risks

The current stack still has several demo-era operational constraints:

- in-memory rate limiting is single-process only
- snapshot cache is in-process only
- curated Q&A corpus is static JSON in the repo
- integration tests can accidentally depend on live DB reachability
- no background-job substrate exists yet for authoring workflows

---

## 4. Target Production Infrastructure Model

## 4.1 Runtime plane

Runtime infrastructure should support:

- low-latency synchronous turn handling
- cache-backed approved corpus lookup
- session and telemetry persistence
- predictable integration with Tavus, ElevenLabs, and the classifier

Suggested runtime building blocks:

- Next.js API route or dedicated runtime service entrypoint
- Postgres for durable system state
- Redis for distributed cache and rate limiting
- object storage only for audio artifacts if retention is needed
- observability stack for traces, metrics, and logs

## 4.2 Authoring plane

Authoring infrastructure should support:

- document upload and immutable version storage
- text extraction
- draft generation jobs
- editorial review workflows
- corpus publish and rollback

Suggested authoring building blocks:

- same monolith application for admin UI and APIs
- background job queue
- worker processes
- object storage for source documents
- Postgres for metadata and editorial state

---

## 5. Environment Variables

This section reflects the current codebase and indicates where production expansion is expected.

### 5.1 Current database variables

| Variable | Scope | Current use |
|---|---|---|
| `DATABASE_URL` | server | pooled application DB connection |
| `DIRECT_URL` | server | direct connection for migrations/scripts |

### 5.2 Current auth variables

| Variable | Scope | Current use |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | client + server | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | client + server | public auth key |
| `SUPABASE_SERVICE_ROLE_KEY` | server | admin Supabase client |

### 5.3 Current Tavus variables

| Variable | Scope | Current use |
|---|---|---|
| `TAVUS_API_KEY` | server | Tavus conversation create/delete |
| `TAVUS_REPLICA_ID` | server | optional replica override |
| `NEXT_PUBLIC_TAVUS_PERSONA_ID` | client | persona used by the demo runtime |

### 5.4 Current ElevenLabs variables

| Variable | Scope | Current use |
|---|---|---|
| `ELEVENLABS_API_KEY` | server | STT in `src/screen/stt.ts` |
| `ELEVENLABS_VOICE_ID` | setup-only | persona provisioning script / Tavus persona patching |

### 5.5 Current classifier variables

| Variable | Scope | Current use |
|---|---|---|
| `ANTHROPIC_API_KEY` | server | fallback classifier |
| `ANTHROPIC_MODEL_ID` | server | optional classifier model override |

### 5.6 Current app configuration

| Variable | Scope | Current use |
|---|---|---|
| `NEXT_PUBLIC_VAD_SILENCE_TIMEOUT_MS` | client | client-side silence timeout for VAD |
| `LOG_LEVEL` | server | logger threshold |
| `NODE_ENV` | server | standard environment mode |

### 5.7 Target production additions

The production product will likely require additional variables such as:

| Variable | Scope | Purpose |
|---|---|---|
| `REDIS_URL` | server/worker | distributed cache and rate limiting |
| `QUEUE_URL` or vendor-specific queue vars | worker | background jobs |
| `DOCUMENT_STORAGE_BUCKET` | server/worker | source document storage |
| `DOCUMENT_STORAGE_REGION` | server/worker | object storage region |
| `RUNTIME_CORPUS_CACHE_KEY` | server | active published corpus coordination |
| `OBSERVABILITY_DSN` | server/worker | error and trace export |
| `TURN_AUDIO_RETENTION_ENABLED` | server | whether audio artifacts are retained |

These are not yet implemented in code and should be introduced alongside the relevant phases.

---

## 6. Current Data Storage

### 6.1 Current Postgres usage

Current Postgres tables fall into two groups:

- user/auth/session tables in `src/db/schema.ts`
- screening snapshot / holdings tables in `src/db/screen-schema.ts`

The current curated Q&A corpus does **not** live in Postgres. It lives in:

- `data/fund-qa.json`
- `data/process-qa.json`

That is appropriate for the current demo, but it is the main blocker for client-editable production authoring.

### 6.2 Current file-based content

The repository currently stores:

- curated Q&A JSON
- ASX snapshot input files
- extracted fund documents under `docs/fund-data/`
- generated audio/video media under `public/audio` and `public/video`

This is acceptable for a demo artifact repository, but production editing requires moving document and corpus content into managed storage and database-backed workflows.

---

## 7. Target Data Storage

## 7.1 Postgres responsibilities

In the target state, Postgres should store:

- documents and document versions metadata
- extracted chunk metadata
- draft Q&A entries
- editorial state
- approved corpus entries
- published corpus versions
- runtime sessions and turn telemetry
- audit trails

## 7.2 Object storage responsibilities

Object storage should store:

- uploaded source documents
- extracted text artifacts when needed
- optional turn audio retention artifacts
- optional compiled corpus artifacts if stored outside Postgres

## 7.3 Cache responsibilities

Redis or equivalent cache should hold:

- active published corpus artifact
- distributed rate-limit counters
- optional hot session state
- publish invalidation signals

Runtime must not depend on cold Postgres reads for every answer lookup if low latency is a hard requirement.

---

## 8. Background Jobs and Queues

The current codebase has no general-purpose background job infrastructure. Production authoring requires it.

Suggested job families:

- `document.extract`
- `document.chunk`
- `draft-qa.generate`
- `draft-qa.generate-variants`
- `corpus.publish.compile`
- `corpus.publish.cache-warm`
- `telemetry.aggregate`

Suggested execution pattern:

- application API enqueues work
- worker process executes work
- job state is persisted
- admin UI polls or subscribes to progress

This keeps slow LLM/document tasks out of synchronous runtime requests.

---

## 9. Networking and Request Paths

### 9.1 Current public request paths

Current public routes:

- `GET /api/v1/screen/snapshot`
- `POST /api/v1/screen/apply-filter`
- `POST /api/v1/screen/stock-fact`
- `POST /api/v1/screen/portfolio-overlap`
- `POST /api/v1/screen/process`
- `POST /api/v1/demo/tavus`
- `DELETE /api/v1/demo/tavus/[conversationId]`

### 9.2 Target runtime request path

The target runtime should collapse the public turn flow into:

- `POST /api/runtime/turn`

Auxiliary runtime routes may remain for bootstrap/session setup, but the turn path should be singular and server-owned.

### 9.3 Target admin request path

The target authoring plane should be exposed through authenticated admin APIs under a distinct namespace, for example:

- `/api/admin/documents/*`
- `/api/admin/drafts/*`
- `/api/admin/corpus/*`

---

## 10. Rate Limiting

### 10.1 Current state

Current rate limiting is implemented in `src/server/rate-limit.ts` as:

- in-memory
- per-process
- sliding-window
- suitable for demo spend protection

This is currently wired into:

- `POST /api/v1/screen/process`
- `POST /api/v1/demo/tavus`
- `DELETE /api/v1/demo/tavus/[conversationId]`

### 10.2 Target state

Production rate limiting should move to a distributed implementation:

- Redis-backed counters or vendor-managed edge limits
- separate policies for anonymous runtime users and authenticated admins
- burst and sustained limits
- cost-aware controls for STT/Tavus-heavy paths

---

## 11. Deployment Model

## 11.1 Current deployment

The current application can be deployed as a single Next.js project with environment variables and DB connectivity.

Current supporting scripts and infrastructure include:

- `scripts/run-migration.ts`
- `scripts/ingest-asx-snapshot.ts`
- `scripts/create-tavus-echo-persona.ts`
- `cdk/` media helper infrastructure

## 11.2 Target deployment shape

The recommended production deployment remains modest:

- one web application deployment
- one worker deployment
- one Postgres database
- one object storage bucket
- one Redis/cache service
- observability service(s)

This avoids premature microservice complexity while supporting the needed workloads.

---

## 12. Observability and Operations

### 12.1 Current state

Current observability is mostly:

- structured application logs via `src/lib/logger.ts`
- `traceId` propagation through routes and error envelopes
- startup environment validation via `instrumentation.ts`

This is a good start, but it is not yet a full operational platform.

### 12.2 Target state

Production observability should add:

- runtime turn latency metrics
- STT/classifier/Tavus vendor timing breakdowns
- publish job metrics
- job failure alerts
- audit dashboards
- distributed traces across runtime turns and jobs

Suggested key metrics:

- runtime turn total latency
- STT latency
- classifier fallback rate
- answer-match confidence / clarification rate
- Tavus init failure rate
- publish duration
- draft generation error rate

---

## 13. Security Posture

### 13.1 Current state

Current security boundaries:

- public demo routes are intentionally unauthenticated
- authenticated app routes use Supabase cookie/Bearer auth
- RLS is used on user-domain tables
- third-party API keys remain server-side

### 13.2 Target state

Production authoring introduces stronger requirements:

- admin role enforcement
- document access control per tenant/client
- audit log for editorial and publishing actions
- stronger secret rotation discipline
- validation and malware scanning for uploads if required by policy

---

## 14. Testing and Environment Discipline

### 14.1 Current state

The current test harness is partially environment-coupled:

- `vitest.config.ts` loads `.env.local`
- some route/provider suites run when `DATABASE_URL` is present
- a developer environment can therefore accidentally run tests against an unavailable external DB

This is a documentation-relevant fact because it affects CI design and reliability.

### 14.2 Target state

The production platform should standardize on:

- hermetic unit tests
- isolated test DB for integration tests
- background job test harness
- deploy-time smoke checks
- environment-specific runtime health checks

---

## 15. Production Readiness Summary

### Current infrastructure readiness

The current codebase is suitable for:

- demos
- internal pilots
- controlled proof-of-concept usage

### Target infrastructure readiness

To support a client-editable, production-quality product, the platform must add:

- authoring storage model
- background jobs
- published corpus versioning
- distributed cache/rate limiting
- stronger observability
- admin authorization model

That target is covered by the implementation phases in [plans/production-modernization-plan.md](./plans/production-modernization-plan.md).
