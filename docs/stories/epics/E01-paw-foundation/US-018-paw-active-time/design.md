
# Design

## Domain Model

The slice introduces:

- Active-time config view.
- State timing segment.
- Active-time calculation result.
- Validation issues for malformed timing input.

## Application Flow

Future orchestrator code records state entry/exit timestamps. The active-time
helper receives those segments and the runtime config, then returns SLA-ready
active elapsed time while excluding configured human-wait states.

## Interface Contract

The TypeScript foundation exports:

- Active-time segment and result types.
- Active-time calculation helper.

## Data Model

Each segment records a Paw state name, start timestamp, and optional end
timestamp. Missing end timestamps use the caller-provided `now`.

## UI / Platform Impact

No user-facing CLI behavior changes in this slice.

## Observability

The result includes paused segments and reasons so future reports can explain
why human wait did not count against SLA.

## Alternatives Considered

1. Count blocked time as normal elapsed time.
   Rejected because SPEC explicitly excludes human approval wait from SLA.
2. Hardcode `BLOCKED_NEEDS_USER_DECISION`.
   Rejected because the default config owns the pause-state list.
