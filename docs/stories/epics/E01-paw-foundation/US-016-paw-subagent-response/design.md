
# Design

## Domain Model

The slice introduces:

- Sub-agent raw response input.
- Accepted, retry, and blocked response decisions.
- Expected metadata checks for agent, session id, and artifact ref.
- Blocked fallback output construction.

## Application Flow

Future sub-agent runtime code receives raw model/provider output and calls this
policy before continuing. Valid output moves forward. First invalid output asks
the caller to retry with the same prompt contract. A second invalid output
becomes a structured blocked result.

## Interface Contract

The TypeScript foundation exports:

- Sub-agent response decision types.
- Response evaluation helper.

## Data Model

The blocked fallback is a normal `PawSubAgentOutput` with status `blocked`,
confidence `low`, empty file lists, the configured artifact ref, and a
`CONTEXT_MISSING` blocked reason that includes the validation failure summary.

## UI / Platform Impact

No user-facing CLI behavior changes in this slice.

## Observability

Retry and blocked decisions keep path-level validation issues so reports can
explain exactly why the sub-agent response was rejected.

## Alternatives Considered

1. Throw on invalid output.
   Rejected because SPEC requires one retry and then a blocked result.
2. Accept parsed JSON without metadata checks.
   Rejected because the orchestrator must not accidentally accept another
   session or role's response.
