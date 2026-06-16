# ADR-19: Multi-slice execution

- **Status:** Accepted
- **Date:** 2026-06-16
- **Deciders:** Tech Lead

## Context
The planner emits multiple vertical slices, but v0.3's state machine had only a single
IMPLEMENTING→REVIEWING→VERIFYING pass with no loop — leaving multi-slice execution undefined and
budget accounting unclear.

## Decision
The orchestrator **loops** per slice: `SLICE_SELECT → IMPLEMENTING → REVIEWING → VERIFYING →
SLICE_DONE → (more slices? SLICE_SELECT | none? FINAL_REPORT)`. Each slice gets a **per-slice
sub-budget** and a **per-slice checkpoint**. On resume, **completed slices are never redone**
(idempotency via content hashes).

## Consequences
- (+) Real plans (multi-step) execute correctly and resumably.
- (+) Per-slice budget/checkpoint contains blast radius and cost.
- (-) Orchestrator state machine and journaling are more complex.

## Revisit trigger
None (foundational to the build loop).

## Related
SPEC §6.3, §8.5, §13; ADR-16, ADR-21.
