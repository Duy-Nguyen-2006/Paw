
# Design

## Domain Model

The slice introduces:

- `PawRiskScoringInput`: structured booleans and counts that represent SPEC §7
  risk inputs.
- `PawRiskScore`: maximum risk level plus reasons.
- `PawTaskClassification`: task class plus risk score and reasons.

## Application Flow

Future intake/orchestration code will build a risk input from prompt analysis
and repository facts, then call this helper before choosing the execution path.
The helper is deterministic and conservative: when configured trivial
requirements are not all satisfied, the result is at least `standard`; when
R3+ or security-sensitive signals appear, the result is `high_risk`.

## Interface Contract

The TypeScript foundation exports:

- Risk scoring from structured input.
- Task classification from structured input and runtime config.
- Small helpers for risk-level maximum comparison.

## Data Model

No filesystem or database changes.

## UI / Platform Impact

No user-facing CLI behavior changes in this slice.

## Observability

Returned reasons explain the signals that drove escalation.

## Alternatives Considered

1. Model-only task classification.
   Rejected because SPEC requires conservative deterministic routing rules.
2. Treat everything non-trivial as standard.
   Rejected because R3+ and security-sensitive paths need explicit high-risk
   handling.
