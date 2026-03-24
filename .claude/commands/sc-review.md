---
allowed-tools: [Read, Grep, Glob, Bash, TodoWrite, Task]
description: "Review implementation for quality across 7 dimensions with severity ratings"
---

# /sc:review - Code Quality Review

## Purpose
Perform comprehensive quality review of implementation across correctness, patterns, performance, security, maintainability, technical debt, and test coverage.

## Usage
```
/sc:review [target] [--focus dimension] [--severity critical|all]
```

## Arguments
- `target` - Files, directories, PR, or recent changes to review
- `--focus` - Focus on specific dimension (correctness, patterns, performance, security, maintainability, debt, tests)
- `--severity` - Filter by severity level

## Review Dimensions

### 1. Correctness
- Bugs, edge cases, error handling gaps
- Race conditions or data integrity issues
- Null/undefined handling

### 2. Patterns
- Adherence to existing project conventions
- Anti-patterns, code smells, unnecessary complexity
- DRY violations, SOLID principle adherence

### 3. Performance
- N+1 queries, unnecessary re-renders
- Missing indexes, unoptimised loops
- Database operation batching

### 4. Security
- Injection risks (SQL, XSS, command)
- Missing auth checks, exposed secrets
- Input validation gaps

### 5. Maintainability
- Code readability and structure
- Magic numbers, unclear naming, missing types
- Would a new developer understand it?

### 6. Technical Debt
- Does this introduce debt?
- Is it documented and justified?
- Workarounds vs proper solutions

### 7. Test Coverage
- Critical paths tested?
- Edge cases covered?
- Tests meaningful (not just passing)?

## Output Format
For each issue found:
- **Location**: File:line
- **Dimension**: Which of the 7 dimensions
- **Severity**: critical | moderate | minor
- **Issue**: Clear description
- **Fix**: Specific remediation

## Execution
1. Identify scope of review (files, changes, PR)
2. Read and analyze each file systematically
3. Check against each dimension
4. Rate severity and provide specific fixes
5. Summarise findings by severity count
