---
allowed-tools: [Read, Grep, Glob, Bash, TodoWrite, Task]
description: "Review implementation plan before coding begins - find blockers and warnings"
---

# /sc:plan-review - Pre-Implementation Plan Review

## Purpose
Validate implementation plans before coding begins. Identify blockers that must be fixed and warnings to proceed with awareness.

## Usage
```
/sc:plan-review [plan-file-or-description]
```

## Arguments
- `plan-file-or-description` - Path to plan document or inline plan description

## Review Dimensions

### 1. Completeness
- Missing steps or unaddressed edge cases?
- Implicit assumptions that should be explicit?
- Error/failure scenarios covered?

### 2. Architecture Fit
- Aligns with existing codebase patterns and conventions?
- Will it conflict with anything already built or planned?
- Is it DRY and adopts best practices already in codebase?

### 3. Dependency Order
- Steps sequenced correctly?
- Dependencies that could cause issues if later step fails?
- Rollback implications of ordering?

### 4. Risk Assessment
- What could go wrong?
- What are the hardest parts?
- Where is plan most likely to need revision?

### 5. Scope
- Anything in plan that isn't necessary for stated goal?
- Anything missing that will be needed?
- Scope creep indicators?

### 6. Testing Strategy
- What tests should be written?
- At what phase (TDD - before implementation)?
- What validation confirms feature works end-to-end?

### 7. Rollback
- If this goes wrong partway through, what's the recovery path?
- Can changes be reverted safely?
- Data migration rollback strategy?

## Output Format
Flag issues as:

**BLOCKER** - Must fix before starting
- Issue description
- Why it blocks progress
- Suggested resolution

**WARNING** - Proceed with awareness
- Issue description
- Risk if ignored
- Mitigation approach

## Execution
1. Read and understand the plan
2. Cross-reference with existing codebase patterns (CLAUDE.md, existing code)
3. Evaluate against each dimension
4. Categorise findings as blockers or warnings
5. Provide actionable recommendations
