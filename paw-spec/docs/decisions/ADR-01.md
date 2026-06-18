
# ADR-01: Sub-agent runtime

- **Status:** Accepted
- **Date:** 2026-06-16
- **Deciders:** Tech Lead, BE1, BE2

## Context
Paw needs context-isolated sub-agents (scout/planner/worker/reviewer). `pi-subagents` (nicobailon)
is a young, single-maintainer Pi-harness extension. Depending on it directly couples us to the Pi
harness and to upstream churn.

## Decision
Implement our own thin `SubAgentRuntime` interface. Borrow **concepts only** (delegation, bounded
artifacts, parent/child isolation) from pi-subagents. **No runtime dependency** on the package.

## Consequences
- (+) No lock-in; we control the contract (`schemas/subagent-contract.schema.json`).
- (+) Upstream breakage cannot break Paw at runtime (removes that item from the active risk surface).
- (-) We re-implement orchestration ourselves (more code in P0/P1).

## Revisit trigger
We need delegation features beyond our interface that pi-subagents already solves well.

## Related
SPEC §5, §14; ADR-15, ADR-19.
