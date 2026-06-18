
# Design

## Domain Model

The slice introduces:

- Planner slice input shape.
- Normalized ordered slice queue.
- Validation issues for malformed planner output.

## Application Flow

Future orchestrator code receives a valid planner sub-agent output, passes
`plan_slices` to this helper, then sends the resulting `slice_ids` into the
existing `PLAN_APPROVED` state transition.

## Interface Contract

The TypeScript foundation exports:

- Planner slice and queue types.
- Planner slice queue validation helper.

## Data Model

Each slice has `slice_id`, `title`, `order`, optional `target_files`,
optional `max_risk_level`, and optional `acceptance`.

## UI / Platform Impact

No user-facing CLI behavior changes in this slice.

## Observability

Validation returns path-level issues so future planner reports can explain why a
plan was rejected instead of entering a broken slice loop.

## Alternatives Considered

1. Trust the planner's array order.
   Rejected because SPEC says the planner emits ordered slices and the order
   field should be deterministic.
2. Let duplicate slices through and rely on state validation.
   Rejected because completed slices must not be redone on resume.
