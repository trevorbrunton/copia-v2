---
allowed-tools: [Read, Write, Edit, Grep, Glob, Bash, TodoWrite, Task]
description: "Create implementation plans that enforce TDD, DRY, architecture standards, and include built-in quality review"
---

# /sc:create-plan - Implementation Plan Generator

## Purpose
Generate comprehensive, ready-to-implement plans that enforce TDD methodology, DRY principles, the App Architecture standard (`docs/architecture/standards/app_architecture_annotated_guide.md`), and include all quality checks from the plan-review skill built-in.

## Usage
```
/sc:create-plan [feature-description] [--tier A|B] [--scope file|module|project]
```

## Arguments
- `feature-description` - What needs to be built
- `--tier` - Architecture tier: A (full ceremony) or B (lightweight). Default: A
- `--scope` - Scope level for impact assessment

## Architecture Standards Enforcement

Every plan MUST comply with the App Architecture annotated guide. Before generating any plan:

1. **Read** `docs/architecture/standards/app_architecture_annotated_guide.md` for canonical patterns
2. **Read** `CLAUDE.md` for project-specific conventions
3. **Verify** the plan uses the correct tier (A or B) from the "Choosing a Path" section

### Tier A (Default) — Plan MUST include:
- Command/query handler separation (CQRS)
- Unit of Work for all writes (`deps.uow.run(ctx, ...)`)
- Outbox events for async side effects (gated by `OUTBOX_ENABLED`)
- Policy checks (`deps.xxxPolicy.assertCanXxx(ctx)`)
- Zod input validation (`XxxInput.parse(rawInput)`)
- Typed API client module in `src/lib/api/`
- TanStack Query hooks in `src/hooks/`
- Thin route handlers under 40 lines using `fromSecureContext` + `handleAppError`

### Tier B — Plan MUST include:
- AuthContext resolution
- Zod validation
- Policy check (even if noop)
- Unit of Work for writes
- DTO responses

## TDD Enforcement

Every plan MUST follow Red-Green-Refactor. Structure tasks as:

```
### Task N: [Feature Name]

#### Tests First (RED)
- [ ] Write failing test: [test description]
- [ ] Write failing test: [test description]

#### Implementation (GREEN)
- [ ] Implement minimal code to pass tests
- [ ] Files: [list of files to create/modify]

#### Refactor
- [ ] Extract shared logic if duplicated
- [ ] Verify all tests still pass
```

Test types required per layer (from Architecture Testing Strategy):
| Layer | Test Type | Dependencies |
|-------|-----------|-------------|
| Command handlers | Unit test with fake deps | Fake UoW, spy outbox |
| Query handlers | Unit test with fake deps | Fake ReadOnly |
| Policies | Unit test | Pure functions |
| Route handlers | Regression test | Mock secureHandler |
| Hooks | Unit test | Mock API client |

## DRY Enforcement

Before creating any new code, the plan MUST:

1. **Search** for existing patterns: `Grep` for similar function names, types, or patterns
2. **Reference** existing utilities: filter builders, shared schemas, API client modules
3. **Extract** if duplicating: identify shared logic and plan extraction to utilities
4. **Document** reuse: note which existing patterns are being followed

## Plan Document Structure

```markdown
# [Feature Name] Implementation Plan

**Version:** 1.0
**Date:** [date]
**Status:** Ready for review
**Tier:** A | B
**Estimated Duration:** [time]

---

## 1. Summary
[What is being built and why]

## 2. Architecture Decisions
[Which patterns from the architecture guide apply]

### Layer Mapping
| Layer | Component | Pattern |
|-------|-----------|---------|
| Transport | `app/api/v1/xxx/route.ts` | Thin handler, fromSecureContext, handleAppError |
| Application | `src/server/commands/xxx.ts` | CQRS command, Zod validation, UoW |
| Data | `src/services/xxx-service.ts` | Service with (tx, userId, ...) |
| Client | `src/hooks/use-xxx.ts` | TanStack Query + optimistic updates |

### Existing Patterns Reused
- [List of existing utilities, patterns, schemas being reused]

## 3. Task Breakdown (TDD)

### Task 1: [Name]
#### Tests First (RED)
- [ ] ...
#### Implementation (GREEN)
- [ ] ...
#### Refactor
- [ ] ...

## 4. Files Inventory
### New Files
| File | Purpose |
|------|---------|
### Modified Files
| File | Change |
|------|--------|

## 5. Database Changes
[Migrations needed, if any. Include RLS policies.]

## 6. Quality Review (Built-In)

### 6.1 Completeness
- [ ] All layers covered (transport → application → data → client)
- [ ] Error scenarios handled
- [ ] Edge cases identified

### 6.2 Architecture Fit
- [ ] Follows annotated guide patterns
- [ ] Uses correct tier (A or B)
- [ ] Route handlers under 40 lines
- [ ] CQRS separation (commands vs queries)
- [ ] UoW for all writes
- [ ] Outbox for async side effects (Tier A)

### 6.3 Dependency Order
- [ ] Tasks sequenced correctly (tests before implementation)
- [ ] Database migrations before code that depends on them
- [ ] Shared schemas before route handlers

### 6.4 Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|

### 6.5 Scope
- [ ] Nothing unnecessary included
- [ ] Nothing required is missing
- [ ] Scope creep indicators flagged

### 6.6 Testing Strategy
- [ ] TDD enforced (tests before code)
- [ ] Handler tests with fake deps
- [ ] Route regression tests
- [ ] Coverage target: 80% for new code

### 6.7 Rollback
- [ ] All changes revertible via git
- [ ] Database migrations have rollback SQL
- [ ] Feature flags for gradual rollout (if applicable)

### Blockers
[List any blockers that must be resolved before starting]

### Warnings
[List any warnings to proceed with awareness]

## 7. Acceptance Criteria
- [ ] All tests pass (RED → GREEN verified)
- [ ] `bun run lint` clean (0 errors)
- [ ] Route handlers under 40 lines
- [ ] No `eslint-disable` without `-- reason`
- [ ] CLAUDE.md updated if new patterns introduced

## Document History
| Version | Date | Changes |
|---------|------|---------|
```

## Execution Steps

1. **Understand the requirement** — Parse the feature description
2. **Research the codebase** — Find existing patterns, schemas, services
3. **Determine tier** — A (default) or B based on scope
4. **Map to layers** — Transport, application, data, client
5. **Identify reuse** — Existing utilities, filter builders, shared schemas
6. **Structure TDD tasks** — Tests first for every task
7. **Run quality review** — Evaluate against all 7 dimensions
8. **Flag blockers/warnings** — Before the plan is marked ready
9. **Write the plan** — Using the document structure above
10. **Save to `docs/plans/`** — As `[feature-name]-plan.md`
