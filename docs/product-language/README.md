# Product Language & Terminology

This directory defines the **canonical terminology** for the EnovaMotion (灵动创影) codebase. Using consistent terms reduces ambiguity for AI agents and developers when reading code, writing docs, or discussing features.

## Scope

| Document | Purpose |
|----------|---------|
| [glossary.md](./glossary.md) | Canonical terms, their code-level representation, discouraged synonyms, and why the distinction matters |
| [product-reference.md](../product-reference.md) | Product capabilities, domain model, and feature matrix — the *facts* about what the product does |

**product-reference.md** answers "what is the product?". This directory answers "what words should we use to describe it?"

## Rules

1. **Use the canonical term** in code, docs, API responses, and UI text.
2. **Do not use discouraged synonyms** — they create ambiguity and make search/grep harder.
3. **When introducing a new concept**, add it to `glossary.md` in the same PR.
4. **Status names are uppercase** in code (`SUCCEEDED`, `FAILED`) and human-readable in UI.
5. **Amounts are always integers**: credits (1 credit = 1 unit), cost (micro-USD), payment (cents). Never use floats.

## Relationship to other docs

- [product-reference.md](../product-reference.md): links to this glossary for term definitions.
- [AGENTS.md](../../AGENTS.md): uses these terms in invariants.
- [ADR-0004](../adr/0004-credits-reserve-settle-release-wallet.md): uses Reserve/Settle/Release terminology.
