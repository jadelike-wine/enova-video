# Implementation Plans

This directory is the **long-term home for implementation plans and PRDs**. Plans document *how* a specific change was or will be implemented — they are not architectural decisions (see [ADR](../adr/)) and not product facts (see [product-reference.md](../product-reference.md)).

## Why keep historical plans?

Completed plans are retained as historical context. They explain **why specific steps were taken**, what alternatives were considered, and what was tested. When a future agent asks "why was it done this way?", the plan provides the answer that a commit message or ADR alone cannot.

## Status conventions

| Status | Meaning |
|--------|---------|
| `active` | Plan is currently being implemented or is next to be picked up. |
| `completed` | Plan has been fully implemented. Retained for historical context. |
| `superseded` | Plan has been replaced by a newer plan or a different approach. Link to the superseding document. |
| `abandoned` | Plan was started but is no longer relevant. Explain why. |

## Naming convention

```
YYYY-MM-DD-<short-kebab-case-description>.md
```

Example: `2026-08-14-runtime-system-settings-storage-logging.md`

## Plan vs. ADR

| | Plan | ADR |
|--|------|-----|
| **Scope** | A specific implementation effort | A fundamental architectural choice |
| **Time** | Point-in-time; completed plans are historical | Persistent; superseded but not deleted |
| **Content** | Step-by-step tasks, file lists, checkboxes | Context, decision, alternatives, consequences |
| **Link to** | May reference ADRs that constrain the design | May reference plans that implement the decision |

## How to link

Plans should link to:
- Relevant [ADRs](../adr/) that constrain the design.
- [product-reference.md](../product-reference.md) sections that define the product boundary.
- Git commits, PRs, or issues that implement the plan.
- Related plans (supersession chain).

## Existing plans

Plans previously lived in `docs/superpowers/plans/`. They are **kept in place** to avoid breaking existing references. The index below links to both locations.

### Index

| Plan | Status | Location |
|------|--------|----------|
| Runtime System Settings for Storage, Billing, and Logging | Completed | [docs/superpowers/plans/2026-08-14-runtime-system-settings-storage-logging.md](../superpowers/plans/2026-08-14-runtime-system-settings-storage-logging.md) |
| Email, Support, and Rate-Limit System Settings | Completed (partially — Tasks 5–6 have unchecked items) | [docs/superpowers/plans/2026-08-14-email-support-rate-limit-settings.md](../superpowers/plans/2026-08-14-email-support-rate-limit-settings.md) |

> The `docs/superpowers/plans/` directory is the original location used by agentic workflow tooling. Do not move or delete those files. New plans should be created directly in `docs/plans/`.
