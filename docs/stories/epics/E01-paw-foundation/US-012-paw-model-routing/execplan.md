
# Execution Plan

## Steps

1. Add a pure model routing module under `packages/coding-agent/src/paw/`.
2. Export public model routing types and helpers from the Paw barrel.
3. Add focused unit tests for role routes, thinking gates, and failover targets.
4. Run the focused Paw model routing tests.
5. Run `npm run check`.
6. Update Harness story evidence and trace.

## Guardrails

- No `any`.
- No inline imports.
- No provider calls or credential reads.
- Use `PawRuntimeConfig`.
- Do not commit.

## Rollback

Remove the new module, export entries, and focused tests. No persistent runtime
data is affected.
