
# Design

## Domain Model

The slice introduces:

- LLM call outcome inputs for timeout, 5xx, 429, all-down, and other errors.
- Tool/sub-agent timeout decisions.
- Loop-cap decisions.
- Verification gate availability decisions.
- Degraded-step markers.

## Application Flow

Future orchestrator code will call these helpers after a provider/tool/gate
outcome. The helper returns a structured decision such as retry, failover,
blocked, escalated, verified, or unverified.

## Interface Contract

The TypeScript foundation exports:

- LLM resilience decision evaluation.
- Tool and sub-agent timeout decisions.
- Loop-cap decision evaluation.
- Verification gate availability evaluation.
- Degraded marker creation.

## Data Model

No filesystem or database changes.

## UI / Platform Impact

No user-facing CLI behavior changes in this slice.

## Observability

Blocked and unverified decisions include code, message, and suggested action or
reason fields suitable for final reports.

## Alternatives Considered

1. Encode liveness only in orchestrator control flow.
   Rejected because pure decision helpers make the invariant testable before
   orchestration is wired.
2. Treat unrunnable gates as passed.
   Rejected because SPEC §9.1 requires explicit `done_with_unverified[...]`.
