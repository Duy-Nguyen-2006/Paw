
# ADR-10: Cost control

- **Status:** Accepted
- **Date:** 2026-06-16
- **Deciders:** Tech Lead

## Context
Tracking cost without capping it does not protect users; sub-agent fan-out + extended thinking can
burn large amounts per task.

## Decision
**Hard per-class token+USD budgets** with **per-slice sub-budgets**. On exceed: **confirm-to-continue**
(interactive) / **fail-closed abort** (non-interactive). See `config.yaml: budget`.

## Consequences
- (+) Predictable spend; no runaway tasks.
- (-) Legitimate high-risk tasks may hit the cap and require confirmation (high_risk cap set generously at $3.00).

## Revisit trigger
Org-level quotas / pooled budgets are needed.

## Related
SPEC §8.6, §9.6; ADR-16, ADR-19.
