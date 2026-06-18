
# ADR-11: Graph / embeddings code intelligence

- **Status:** Accepted
- **Date:** 2026-06-16
- **Deciders:** Tech Lead, Architect

## Context
A GitNexus-style code graph + embeddings is powerful but is effectively a product in itself
(indexing, invalidation, storage, query). Building it in v1 would dominate the schedule.

## Decision
Graph/embeddings are **deferred to `[V2]+`**. v1 scout uses **ripgrep + ctags + git** with caching
by git-tree hash.

## Consequences
- (+) Keeps the MVP focused; scout is fast and cheap on typical repos.
- (-) Very large/monorepo navigation is weaker until V2 (validated by P0 spike-4).

## Revisit trigger
Large-repo latency is proven to exceed SLA with the ripgrep/ctags path.

## Related
SPEC §8.1, §21 (spike-4); ADR-02.
