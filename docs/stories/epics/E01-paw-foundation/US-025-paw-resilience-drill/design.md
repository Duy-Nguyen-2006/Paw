
# Design

## Domain Model

The slice introduces:

- Resilience drill event list.
- Drill outcome flags for failover, degraded reporting, resume, and data loss.
- PASS/KILL result with path-level issues and evidence text.

## Application Flow

Future chaos tooling will kill a provider mid-task and feed observed events into
this evaluator. The evaluator records whether S5 passes or must kill/redesign
the resilience path.

## Interface Contract

The TypeScript foundation exports:

- Resilience drill event, input, and result types.
- A deterministic evaluator helper.

## Data Model

Events are explicit strings for provider failure, retry, failover, resume, final
report, and data-loss detection. Input also carries degraded and data-loss
booleans for deterministic evaluation.

## UI / Platform Impact

No user-facing CLI behavior changes in this slice.

## Observability

The result carries evidence text and failure issues so future drill reports can
be recorded in the spike tracker.

## Alternatives Considered

1. Mark S5 complete based only on `evaluatePawLlmFailure` unit tests.
   Rejected because S5 also requires resume and no-data-loss evidence.
2. Run live provider chaos in this slice.
   Rejected because no provider chaos capability is present in Harness.
