
# Execution Plan

## Steps

1. Add a pure resilience policy module under `packages/coding-agent/src/paw/`.
2. Export public resilience types and helpers from the Paw barrel.
3. Add focused unit tests for retry, failover, blocked, degraded, loop-cap, and
   unverified decisions.
4. Run the focused Paw resilience tests.
5. Run `npm run check`.
6. Update Harness story evidence and trace.

## Guardrails

- No `any`.
- No inline imports.
- No provider or subprocess execution.
- Use `PawRuntimeConfig["resilience"]` and `PawRuntimeConfig["verify"]`.
- Do not commit.

## Rollback

Remove the new module, export entries, and focused tests. No persistent runtime
data is affected.
