---
allowed-tools: [Read, Grep, Glob, Edit, Write]
description: "Quick documentation sync after changes - feature list, CLAUDE.md, inline docs"
---

# /sc:update-docs - Quick Documentation Update

## Purpose
Lightweight documentation sync after making changes. Focuses on essential documentation without full close-out process.

## Usage
```
/sc:update-docs [changed-files-or-feature]
```

## Arguments
- `changed-files-or-feature` - Specific files changed or feature name to document

## Documentation Updates

### 1. Feature List (croniq_app_feature_list.md)
- Add/update feature entries for new or changed functionality
- Keep descriptions concise and current

### 2. CLAUDE.md
Update affected sections only:
- Project structure (if files added)
- API routes (if endpoints added/changed)
- Hooks (if React hooks added/changed)
- Key patterns (if new patterns introduced)
- Schema (if database changed)

### 3. Relevant Architecture Docs
- Update any docs in `docs/` that reference changed systems
- Only modify docs directly affected by changes

### 4. Inline Documentation
- Ensure new public APIs have JSDoc comments
- Don't add unnecessary comments to self-explanatory code
- Remove outdated comments from modified code

## Output Format
```
Modified files:
- docs/croniq_app_feature_list.md
- CLAUDE.md
- [any other files]
```

## Execution
1. Identify what changed (from context or git)
2. Update feature list if applicable
3. Update CLAUDE.md sections if applicable
4. Check for affected architecture docs
5. Verify inline documentation on new code
6. List all modified files
