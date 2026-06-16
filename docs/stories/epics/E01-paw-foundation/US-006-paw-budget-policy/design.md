# Design

## Domain Model

The slice introduces budget-specific policy helpers:

- Task spend input: task class, run mode, token usage, USD usage, and budget
  config.
- Slice spend input: task class, token/USD usage for the current slice, and
  budget config.
- Budget decision: `within_budget`, `warn`, `needs_approval`, or `blocked`.

## Application Flow

Future orchestrator steps evaluate budget before starting or continuing work.
The helper returns a structured result. Callers can continue, warn the user,
ask for interactive continuation, or enter `BLOCKED_BUDGET_EXCEEDED` in
non-interactive modes.

## Interface Contract

The TypeScript foundation exports:

- Task budget evaluation.
- Slice budget evaluation.
- Helpers for computing budget utilization.

The helpers must use `PawRuntimeConfig["budget"]` instead of hardcoded budget
numbers.

## Data Model

No filesystem or database changes.

## UI / Platform Impact

No user-facing CLI behavior changes in this slice.

## Observability

Warn, approval, and blocked decisions include the exceeded limit and configured
threshold so reports can explain why execution stopped.

## Alternatives Considered

1. Wait for orchestrator implementation.
   Rejected because budget fail-closed semantics are a core safety contract and
   can be tested independently.
2. Use only one global budget.
   Rejected because SPEC §8.6 requires per-class budgets and per-slice guards.
