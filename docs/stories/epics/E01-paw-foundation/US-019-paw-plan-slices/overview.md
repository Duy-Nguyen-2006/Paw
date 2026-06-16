# US-019: Paw Planner Slice Queue Validation

## User Story

As Paw's orchestrator, I need planner slice output converted into a deterministic
queue so multi-slice execution processes each planned slice exactly once.

## Source References

- `SPEC.md` §6.3 State machine.
- `SPEC.md` §14.1 Sub-agent contract.
- ADR-19 Multi-slice execution.

## Scope

Implement a pure TypeScript helper that validates planner `plan_slices`, sorts
them by order, and returns the ordered slice ids for `PLAN_APPROVED`.

## Non-Goals

- No planner execution.
- No orchestrator loop wiring.
- No checkpoint creation.
- No budget allocation.

## Acceptance Criteria

- Valid planner slices produce an ordered unique slice id queue.
- Input order does not affect output queue order.
- Duplicate slice ids or duplicate orders are rejected.
- Empty plans are rejected.
- Invalid slice ids, titles, orders, target files, or risk levels return
  path-level issues.
