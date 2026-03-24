---
allowed-tools: [Read, Grep, Glob, Bash, Edit, Write, TodoWrite]
description: "Post-implementation documentation updates - plans, CLAUDE.md, feature list, architecture docs"
---

# /sc:close-out - Post-Implementation Documentation

## Purpose
Perform comprehensive documentation updates after implementation is complete. Ensures all project documentation reflects the current state.

## Usage
```
/sc:close-out [plan-file] [--scope full|minimal]
```

## Arguments
- `plan-file` - Original plan document to mark as complete
- `--scope` - Documentation scope (full updates all docs, minimal updates essentials only)

## Documentation Updates

### 1. Plan Status
- Mark all completed plan steps as done
- Note any deviations from original plan and why
- Update plan file with completion timestamp

### 2. CLAUDE.md
Update any sections affected by changes:
- Project structure (new files/directories)
- API routes (new endpoints)
- Hooks (new React hooks)
- Services (new service files)
- Schema (database changes)
- Key patterns (new patterns introduced)
- Environment variables (new config)

### 3. Feature List (croniq_app_feature_list.md)
- Add entries for all new features
- Update entries for changed features
- Include current status and description
- Note any breaking changes

### 4. Architecture Docs
- Update any docs in `docs/` affected by changes
- If new system or pattern introduced, document it
- Update diagrams if architecture changed

### 5. Inline Documentation
For new/significantly modified files:
- Ensure JSDoc for public APIs
- Add comments for non-obvious logic only
- Remove outdated comments

### 6. Schema Changes
If database schema changed:
- Verify schema section in CLAUDE.md reflects current state
- Document migration files
- Update entity relationship descriptions

## Output Format
List all documents updated:
```
Updated files:
- docs/plans/feature-x-plan.md (marked complete)
- CLAUDE.md (API routes, hooks sections)
- docs/croniq_app_feature_list.md (new feature entry)
- docs/architecture/system-x.md (new architecture doc)
```

## Execution
1. Review what was implemented (git diff, plan file)
2. Systematically update each documentation area
3. Verify consistency across all docs
4. List all modified files for review
