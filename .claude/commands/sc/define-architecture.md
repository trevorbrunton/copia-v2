---
allowed-tools: [Read, Write, Edit, Grep, Glob, Bash, TodoWrite, Task]
description: "Define architecture and design for new features — enforces standards, considers alternatives, produces plan-ready documents"
---

# /sc:define-architecture - Architecture & Design Definition

## Purpose
Take a set of requirements and produce a comprehensive architecture and design document that:
- Strictly enforces the App Architecture standards (`docs/architecture/standards/`)
- Explicitly references existing codebase patterns and services
- Considers and documents alternative approaches with rationale for the chosen design
- Prioritises quality, simplicity, efficiency, and avoidance of technical debt
- Produces a document ready to hand to `sc:create-plan` for implementation planning

## Usage
```
/sc:define-architecture [requirements] [--tier A|B] [--scope feature|module|system]
```

## Arguments
- `requirements` - Feature requirements (inline description, file path, or issue reference)
- `--tier` - Architecture tier: A (full ceremony) or B (lightweight). Default: inferred from requirements
- `--scope` - Impact scope: feature (single domain), module (cross-domain), system (infrastructure)

## Mandatory Pre-Work

Before producing any architecture document, the skill MUST:

### 1. Read the Standards
```
Read docs/architecture/standards/app_architecture_annotated_guide.md
Read docs/architecture/standards/app_architecture_developer_guide.md
Read CLAUDE.md (project conventions, existing patterns, tech stack)
```

### 2. Survey the Existing Codebase
- **Services:** `Grep` for existing services that touch the domain
- **Schemas:** `Glob` for related Zod schemas in `src/shared/schemas/`
- **Hooks:** `Grep` for existing hooks that could be extended
- **Routes:** `Glob` for existing routes in the affected domain
- **Migrations:** Check latest migration number for sequencing
- **Tests:** `Glob` for existing test patterns in the domain
- **Feature flags:** Check `src/lib/feature-flags.ts` for related flags

### 3. Identify Reuse Opportunities
- Existing services that already do part of the work
- Shared filter builders (`src/shared/schemas/entities/filters.ts`)
- Existing command/query handlers that could be extended
- Existing Zod schemas that could be composed
- Existing hooks that follow the pattern needed

## Architecture Principles (Non-Negotiable)

These are derived from the architecture standards and MUST be followed:

### Structural
| Principle | Enforcement |
|-----------|------------|
| **Separation of Concerns** | Each layer has one job. Routes parse HTTP. Handlers orchestrate. Services query. |
| **Dependency Inversion** | Handlers depend on abstractions (interfaces), not concrete services. Injected via `makeDeps()`. |
| **Single Responsibility** | Each handler, service, or component has exactly one reason to change. |
| **CQRS** | Commands (writes) and queries (reads) are separate handlers in separate directories. |

### Quality
| Principle | Enforcement |
|-----------|------------|
| **Simplicity over cleverness** | Choose the simplest solution that works. Three lines of code beats a premature abstraction. |
| **No speculative features** | Implement what's needed now. Don't add configurability, feature flags, or abstractions for hypothetical future requirements. |
| **Avoid technical debt** | If a shortcut is taken, document it with a follow-up ticket. Prefer proper solutions over workarounds. |
| **DRY where meaningful** | Extract shared logic only when it's genuinely duplicated (3+ occurrences). Don't create abstractions for 1-2 uses. |

### Security
| Principle | Enforcement |
|-----------|------------|
| **RLS everywhere** | Every new table gets `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` + tenant isolation policy. |
| **Defense in depth** | Services filter by `userId` explicitly, even with RLS active. |
| **Input validation at boundaries** | Zod schemas validate all external input. No raw `request.json()` without parsing. |

### Resilience
| Principle | Enforcement |
|-----------|------------|
| **Atomic transactions** | All writes happen inside `deps.uow.run()`. No partial writes. |
| **Graceful degradation** | Features behind feature flags. Fallback to simpler behaviour when dependencies fail. |
| **Idempotency** | Retry-prone operations use idempotency keys. |

## Alternatives Analysis (Required)

Every architecture document MUST include a section evaluating at least 2 alternative approaches. For each alternative:

```markdown
### Alternative N: [Name]

**Approach:** [Brief description]

**Pros:**
- [Advantage 1]
- [Advantage 2]

**Cons:**
- [Disadvantage 1]
- [Disadvantage 2]

**Why not chosen:** [Specific reason this was rejected]
```

After evaluating alternatives, document the recommended approach with explicit rationale:

```markdown
### Recommended Approach: [Name]

**Why this approach:**
- [Reason 1 — relates to a principle above]
- [Reason 2 — relates to existing codebase patterns]
- [Reason 3 — relates to simplicity/efficiency]

**Trade-offs accepted:**
- [Trade-off 1 and why it's acceptable]
```

## Output Document Structure

```markdown
# [Feature Name] — Architecture & Design

**Version:** 1.0
**Date:** [date]
**Status:** Ready for plan creation
**Tier:** A | B (with justification)
**Scope:** feature | module | system
**Downstream:** Pass to `sc:create-plan` for implementation planning

---

## 1. Requirements Summary

### Functional Requirements
- [FR-1] ...
- [FR-2] ...

### Non-Functional Requirements
- [NFR-1] Performance: ...
- [NFR-2] Security: ...
- [NFR-3] Scalability: ...

### Constraints
- [C-1] Must work with existing [service/table/hook]
- [C-2] Must not break [existing feature]

---

## 2. Existing Codebase Analysis

### Related Services
| Service | Relevance | Reuse Opportunity |
|---------|-----------|-------------------|

### Related Schemas/Types
| Schema | Location | Reuse |
|--------|----------|-------|

### Related Hooks
| Hook | Location | Extend? |
|------|----------|---------|

### Database Impact
| Table | Change | Migration Needed? |
|-------|--------|-------------------|

---

## 3. Architecture Decision

### Alternative A: [Name]
**Approach:** ...
**Pros:** ...
**Cons:** ...
**Why not chosen:** ...

### Alternative B: [Name]
**Approach:** ...
**Pros:** ...
**Cons:** ...
**Why not chosen:** ...

### Recommended: [Name]
**Why this approach:** ...
**Trade-offs accepted:** ...

---

## 4. Detailed Design

### 4.1 Data Model
[Schema changes, new tables, JSONB properties, relationships]

### 4.2 API Design
| Endpoint | Method | Request | Response | Auth |
|----------|--------|---------|----------|------|

### 4.3 Layer Mapping
| Layer | Component | File | Pattern |
|-------|-----------|------|---------|
| Transport | Route handler | `app/api/v1/...` | Thin, fromSecureContext, handleAppError |
| Application | Command handler | `src/server/commands/...` | Zod input, UoW, outbox (Tier A) |
| Application | Query handler | `src/server/queries/...` | Zod input, ReadOnly |
| Data | Service | `src/services/...` | (tx, userId, ...) |
| Client | Hook | `src/hooks/...` | TanStack Query + optimistic updates |
| Shared | Schema | `src/shared/schemas/...` | Zod input/response schemas |

### 4.4 Event Model (Tier A only)
| Event | Trigger | Payload | Consumer |
|-------|---------|---------|----------|

### 4.5 Error Handling
| Error Case | HTTP Status | Error Code | User Message |
|------------|-------------|------------|-------------|

### 4.6 Security Considerations
- RLS policies needed
- Input validation approach
- Authorization policy rules

---

## 5. Architecture Compliance Checklist

| Standard | Status | Notes |
|----------|--------|-------|
| Business logic in handlers, not routes | ☐ | |
| Every write uses UoW | ☐ | |
| Outbox for async effects (Tier A) | ☐ | |
| Route handlers under 40 lines | ☐ | |
| Policies enforce authorization | ☐ | |
| Shared Zod contracts | ☐ | |
| Idempotency for retry-prone commands | ☐ | |
| Observability (traceId, structured logs) | ☐ | |
| TanStack hooks wrap API client | ☐ | |
| New tables have RLS | ☐ | |
| Defense-in-depth userId filtering | ☐ | |
| Input validation at all boundaries | ☐ | |

---

## 6. Future-Proofing

### What this design accommodates without changes:
- [Future scenario 1]
- [Future scenario 2]

### What would require extension:
- [Future scenario 3] → [What would need to change]

### What is explicitly NOT supported (YAGNI):
- [Hypothetical feature 1] — [Why it's not built now]

---

## 7. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|

---

## Document History
| Version | Date | Changes |
|---------|------|---------|
```

## Execution Steps

1. **Parse requirements** — Extract functional, non-functional, and constraints
2. **Read architecture standards** — Load both annotated guide and developer guide
3. **Survey codebase** — Find related services, schemas, hooks, routes, migrations
4. **Identify reuse** — What exists that can be extended vs what's genuinely new
5. **Determine tier** — A or B based on requirements (default A if uncertain)
6. **Evaluate alternatives** — At least 2 approaches with pros/cons
7. **Select and justify** — Document why the recommended approach wins
8. **Design in detail** — Data model, API, layers, events, errors, security
9. **Check compliance** — Verify against architecture guardrails checklist
10. **Assess future-proofing** — What's accommodated vs explicitly deferred (YAGNI)
11. **Flag risks** — With mitigations
12. **Save to `docs/architecture/`** — As `[feature-name]-architecture.md` or to `docs/plans/` if it's a feature-level design
