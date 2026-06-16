# ADR-05: Memory & rules storage

- **Status:** Accepted
- **Date:** 2026-06-16
- **Deciders:** Tech Lead, BE2

## Context
Project memory, rules, and decisions must be durable, reviewable, and diffable. Options: plain
versioned files vs SQLite.

## Decision
**Versioned YAML + file locks** for v1 (`.paw/memory`, `.paw/rules`, `.paw/decisions`). SQLite is
`[LATER]`.

## Consequences
- (+) Human-readable, git-diffable, trivial to review in PRs; memory/rules/decisions are committed.
- (+) Simple migration via `.paw/version`.
- (-) File locks (not transactions) bound concurrency; mitigated by stale-lock recovery (SPEC §9.3).

## Revisit trigger
Concurrency/scale needs exceed what file locks can safely provide.

## Related
SPEC §12; ADR-17 (concurrency); SPEC §9.3.
