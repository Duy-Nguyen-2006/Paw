# Design

## Domain Model

The slice introduces:

- Sub-agent runtime invocation input.
- Sub-agent executor interface.
- Runtime result that wraps the existing accepted, retry, and blocked response
  decisions.

## Application Flow

Future orchestration code will build a bounded handoff for a role, reserve an
artifact ref, and call the runtime. The runtime rejects oversized handoffs
before execution, delegates actual execution through an injected executor, and
passes raw output to `evaluatePawSubAgentResponse`.

## Interface Contract

The TypeScript foundation exports:

- Runtime input and executor types.
- Runtime result type.
- A helper that invokes an injected executor and evaluates the response.

## Data Model

The runtime carries role, session id, slice id, artifact ref, model metadata,
attempt number, handoff text, and handoff token estimates.

## UI / Platform Impact

No user-facing CLI behavior changes in this slice.

## Observability

The result keeps attempts, issues, and blocked reasons so future traces can
explain why a sub-agent call retried or blocked.

## Alternatives Considered

1. Wire directly to a provider adapter now.
   Rejected because ADR-1 requires a thin interface first and provider execution
   needs separate timeout, sandbox, and cost accounting work.
2. Treat handoff bounds as prompt guidance.
   Rejected because handoff bounds need deterministic runtime enforcement.
