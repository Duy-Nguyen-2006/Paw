
# US-012: Paw Model Routing Policy

## User Story

As Paw's model router, I need config-backed routing helpers so roles and task
classes select the intended model tier, thinking mode, and failover providers
without hardcoded model IDs.

## Source References

- `SPEC.md` §8.3 Intelligence preservation.
- `SPEC.md` §8.4 Speed and model routing.
- ADR-6 Provider abstraction.
- ADR-14 Model routing.
- `paw-spec/config.yaml` `providers`, `model_tiers`, `role_routing`, and
  `thinking` sections.

## Scope

Implement pure TypeScript helpers that resolve role tier selection, model tier
configuration, thinking enablement, and failover provider targets from runtime
config.

## Non-Goals

- No provider network calls.
- No model availability probing.
- No credential loading.
- No prompt construction.

## Acceptance Criteria

- Configured mechanical roles route to the cheap tier.
- Scout/simple worker roles route to the mid tier.
- Planner/reviewer/high-risk worker roles route to the strong tier.
- Thinking is enabled only when both task class and role policy allow it.
- Failover targets follow `model_tiers.failover_order` and include provider
  config.
- Concrete model IDs come only from runtime config.
