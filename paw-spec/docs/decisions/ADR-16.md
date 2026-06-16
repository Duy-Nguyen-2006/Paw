# ADR-16: Task boundary

- **Status:** Accepted
- **Date:** 2026-06-16
- **Deciders:** Tech Lead

## Context
All budgets/SLAs/KPIs are "per task", but "task" was undefined — making every measurement ambiguous
(is `paw build` a new task? is the whole SPEC->verify one task?).

## Decision
A **task = one user intent = one `SPEC.md` = one session id**, spanning INTAKE → FINAL_REPORT. It may
include **multiple slices** and **multiple CLI invocations** (later commands **resume** the same
session, they do not start new tasks). **All budgets/SLAs/KPIs are per-task**, with **per-slice
sub-budgets**.

## Consequences
- (+) Unambiguous accounting for cost, latency, and KPIs.
- (+) Clean resume semantics across commands.
- (-) Session lifecycle/ownership must be tracked carefully in persistence.

## Revisit trigger
None (definitional).

## Related
SPEC §6.1, §8.6, §12; ADR-10, ADR-19.
