# Architecture Critique: Mayfly Developer Guide

**Date:** March 2026
**Subject:** Review of `app_architecture_developer_guide.md` and the promoted application architecture.

## 1. Executive Summary

The proposed architecture in the `app_architecture_developer_guide.md` represents a highly mature, rigorous, and scalable approach to building web applications in the TypeScript/Next.js ecosystem. It heavily borrows from proven enterprise patterns across Clean Architecture, Hexagonal Architecture (Ports and Adapters), and CQRS (Command Query Responsibility Segregation). 

By strictly separating the transport layer (framework) from application business logic, and utilizing advanced transactional patterns (Unit of Work, Outbox, Idempotency), the architecture is exceptionally well-positioned to build reliable, multi-client, and easily testable applications.

However, as with any strict architectural paradigm, it trades initial developer velocity for long-term maintainability. This review outlines the strengths of the architecture, identifies potential friction points (both operational and at the developer level), and offers recommendations to future-proof the design as the application scales.

---

## 2. Strengths of the Architecture (What it gets highly right)

1. **Framework Agnosticism:** By restricting the Next.js/Expo code to the "Transport Layer" and forbidding it from leaking into the "Application Layer," the core business logic remains portable. This is critical for future-proofing against framework shifts or adding new client APIs.
2. **CQRS Implementation:** Segregating commands (writes) from queries (reads) optimizes database access. Commands can utilize heavy transactional locks, while queries can bypass the Unit of Work (using the `readOnly` executor) for high-performance, cacheable reads.
3. **Resilience Patterns:** Native inclusion of the **Outbox Pattern** and **Idempotency Keys** is a standout feature. These are often added as an afterthought in Node.js applications, leading to brittle distributed systems. Providing them as first-class citizens ensures eventual consistency and safe client retries.
4. **Testability via Dependency Injection:** The composition root (`makeDeps()`) allows the entirety of the application layer to be tested using fast, in-memory repository fakes, completely skipping the database wrapper.
5. **Pragmatic Tiering:** The distinction between "Tier A (Durable)" and "Tier B (Lightweight)" acknowledges that not every simple CRUD operation requires the full ceremony of Outbox events and idempotency, reducing unnecessary boilerplate.

---

## 3. Critiques & Architectural Risks

While the foundation is solid, several edge cases and scalability bottlenecks may emerge as the codebase grows.

### 3.1. The Composition Root Bottleneck (`makeDeps`)
**Observation:** `makeDeps()` instantiates every domain dependency (repositories, query services, outbox writers, policies). 
**Risk:** As the application grows to dozens of domains (Projects, Users, Billing, Documents, Workflows, etc.), calling `makeDeps()` on every single API route request will instantiate hundreds of classes, even if the specific route handler only requires two. This can lead to excessive memory allocation and degraded request latency.
**Future-Proofing:** 
* Introduce **Lazy Loading** within the composition root (e.g., using getters).
* Or adopt a lightweight DI container (like `awilix` or `tsyringe`) that resolves dependencies only when requested, caching singletons where appropriate.

### 3.2. Anemic Domain Model vs. Procedural Handlers
**Observation:** The guide promotes placing all business rules inside the Command Handlers (e.g., duplicate checks, state transitions).
**Risk:** This is known as a "Transaction Script" pattern. The data objects (returned by Repositories) are "anemic" (they have no behavior, just data). As business rules become complex, command handlers can bloat into massive procedural scripts that are hard to decipher.
**Future-Proofing:** For highly complex domains, consider pushing behavior down into pure TypeScript **Domain Entities**. Instead of the handler validating a state transition, the handler fetches the `Project` entity, calls `project.transitionToProcessing()`, and saves the entity. 

### 3.3. Database Coupling in the Application Layer
**Observation:** The guide mentions using `DrizzleProjectRepository`. 
**Risk:** If the repository simply returns raw Drizzle schema objects (e.g., matching the exact columns of the database), the Application layer is still implicitly coupled to the database structure. If a DB column name changes, the Application layer might break.
**Future-Proofing:** Enforce that Repositories must map database rows to clean, decoupled **Domain Models / Interfaces** before returning them to the Command Handlers.

### 3.4. Exceptions vs. Result Monads for Control Flow
**Observation:** Domain rules enforce invariants by throwing exceptions (e.g., `throw new ConflictError()`), which are caught and mapped in the Transport layer (`handleAppError`).
**Risk:** Using exceptions for *expected* domain failures (like a duplicate project name, or insufficient funds) hijacks the control flow. Exceptions should ideally be reserved for exceptional, unexpected states (like a database connection dropping).
**Future-Proofing:** Consider returning a `Result` type (`Success | Failure`) from handlers. This forces the consumer (the Transport layer) to explicitly handle the domain error via type-checking, making error handling more predictable and self-documenting in the compiler.

### 3.5. Outbox Polling Scalability
**Observation:** The background worker polls the outbox table using `FOR UPDATE SKIP LOCKED`.
**Risk:** Polling the database continuously can waste database cycles and introduce latency (the event is only processed on the next poll interval). While `SKIP LOCKED` is excellent for concurrency, a massive table can still suffer from index contention.
**Future-Proofing:** As scale demands, be prepared to migrate the Outbox pattern from a polling model to a **Change Data Capture (CDC)** model. Tools like Debezium or PostgreSQL logical replication can stream outbox inserts directly to a message broker (like Kafka/RabbitMQ) with zero polling overhead.

### 3.6. Event Contract Drift
**Observation:** Handlers emit async events via the outbox (e.g., `type: "project.created", payload: { ... }`). 
**Risk:** Who owns the schema for these payloads? If a developer alters the `project.created` payload in the command handler, the background worker relying on the old shape will crash silently in the background.
**Future-Proofing:** Treat Outbox event payloads exactly like HTTP APIs. Define strict **Zod schemas for Event Payloads**, validate the payload before enqueuing it in the Outbox, and version events (e.g., `project.created.v1`) to prevent breaking downstream async workers.

### 3.7. The Dual-Brain Problem of Row-Level Security (RLS)
**Observation:** The guide advocates for "defense in depth" using both Application Policy classes and Database RLS.
**Risk:** While secure, this creates a "dual-brain" problem. When debugging why a user cannot access a project, a developer has to check both the TypeScript `ProjectPolicy` and the PostgreSQL `pg_policies`. Furthermore, complex business logic pushed into RLS is notoriously difficult to unit test without spinning up a real database.
**Future-Proofing:** Keep RLS strictly limited to fundamental tenant isolation (e.g., `tenant_id = current_tenant`). Keep all nuanced, role-based, or state-based authorization logic explicitly in the Application layer (`Policy` classes) where it can be unit tested in milliseconds.

---

## 4. Conclusion

The proposed architecture is exceptionally strong and perfectly suited for a team building a serious, long-lasting product. The core tenets (CQRS, Unit of Work, Outbox) mitigate the most common failure modes of distributed applications.

To ensure it scales without slowing down the team:
1. Ensure `makeDeps()` does not become a performance bottleneck by utilizing lazy initialization.
2. Protect event boundaries with Zod schemas.
3. Keep complex business logic out of the database (RLS) and inside easily testable pure TypeScript functions.
4. Invest heavily in CLI generator tools (like Plop.js) so that developers can quickly scaffold the boilerplate required for Tier A features.
