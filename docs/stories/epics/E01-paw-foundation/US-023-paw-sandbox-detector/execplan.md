
# Execution Plan

## Steps

1. Add a sandbox detector module under `packages/coding-agent/src/paw/`.
2. Export public detector types and helper from the Paw barrel.
3. Add focused tests for all fallback matrix paths and no-sandbox write blocking.
4. Add S3 spike evidence and update the spike tracker.
5. Run focused Paw sandbox detector tests.
6. Run the focused Paw suite through US-023.
7. Run `npm run check`.
8. Update Harness story evidence and trace.

## Guardrails

- No `any`.
- No inline imports.
- No direct shell probing or sandbox process launch.
- Keep runtime enforcement in `evaluatePawSandbox`.
- Do not commit.

## Rollback

Remove the new module, export entries, focused tests, spike evidence, and story
evidence updates.
