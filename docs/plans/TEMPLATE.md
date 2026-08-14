# Implementation Plan Template

## Problem

[What problem does this plan solve? What is the current pain point or missing capability?]

## Goals

[What specific outcomes does this plan aim to achieve?]

## Non-goals

[What is explicitly out of scope? This prevents scope creep and sets expectations.]

## Current State

[What exists today? What works, what doesn't, and what constraints are already in place?]

## Proposed Design

[High-level description of the approach. Reference relevant ADRs and product-reference sections.]

## Implementation Steps

[Break down into tasks with checkboxes. Each task should list affected files.]

### Task 1: [Name]

**Files:**
- Modify: `path/to/file.ts`
- Add: `path/to/new-file.ts`
- Test: `path/to/test.spec.ts`

- [ ] Step description
- [ ] Step description

### Task 2: [Name]

**Files:**
- Modify: `path/to/file.ts`

- [ ] Step description

## Data / API Changes

[Does this plan change the database schema, API contract, queue payload, or shared types? If yes, describe the migration, OpenAPI change, or contract update needed.]

## Migration

[If this plan changes data format or schema, how will existing data be migrated? Is it backward-compatible?]

## Risks

[What could go wrong? What are the security, performance, or consistency risks?]

## Rollback

[If this change needs to be reverted, what is the rollback procedure? Can it be done without data loss?]

## Validation

[How will the change be verified? List lint, typecheck, test, build, and any manual verification steps.]

## Observability

[What metrics, logs, or alerts should be added or monitored after this change?]

## Open Questions

[List unresolved questions that need to be answered before or during implementation.]

## Status

[active | completed | superseded | abandoned]

## References

[Links to ADRs, product-reference sections, commits, PRs, issues, or other plans.]
