
# Design

## Domain Model

The slice introduces:

- Model routing roles matching `role_routing`.
- Resolved model route with tier, provider, model ID, and thinking flag.
- Failover route list from configured provider order.

## Application Flow

Future provider orchestration calls these helpers before an LLM request or
failover. The helper returns config-derived route data only.

## Interface Contract

The TypeScript foundation exports:

- Role model route resolution.
- Thinking policy evaluation.
- Failover provider route resolution.

## Data Model

No filesystem or database changes.

## UI / Platform Impact

No user-facing CLI behavior changes in this slice.

## Observability

Resolved routes expose tier/provider/model names for reports without loading
credentials or calling providers.

## Alternatives Considered

1. Hardcode model IDs in code.
   Rejected because SPEC says concrete model IDs are config.
2. Enable thinking based only on model tier.
   Rejected because SPEC gates thinking by both class and role.
