
# ADR-02: Implementation language

- **Status:** Accepted
- **Date:** 2026-06-16
- **Deciders:** Tech Lead

## Context
Paw is a Linux-native CLI with heavy LLM/MCP/tool integration. The team must hire and iterate fast.
Rust offers performance for indexing/diffing but slows iteration and narrows hiring.

## Decision
**TypeScript-only for v1** (Node.js LTS, pnpm). Rust is `[LATER]`, reserved for measured hotspots
(repo indexing, diff engine, long-running daemon).

## Consequences
- (+) Fast iteration, rich Node/MCP ecosystem, single hiring language.
- (+) Easier sub-agent/tool orchestration.
- (-) Indexing/scan performance may need optimization later.

## Revisit trigger
Indexing or file scanning becomes a measured bottleneck against SLA.

## Related
SPEC §18; ADR-11.
