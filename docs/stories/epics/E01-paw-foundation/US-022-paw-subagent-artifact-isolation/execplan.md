
# Execution Plan

## Steps

1. Add bounded sub-agent artifact report handling under `packages/coding-agent/src/paw/`.
2. Export public artifact isolation types and helper from the Paw barrel.
3. Add focused tests for canonical writes, oversized rejection, and invalid path rejection.
4. Add S1 spike evidence and update the spike tracker.
5. Run focused Paw sub-agent artifact isolation tests.
6. Run the focused Paw suite through US-022.
7. Run `npm run check`.
8. Update Harness story evidence and trace.

## Guardrails

- No `any`.
- No inline imports.
- No direct provider or child process execution.
- Do not commit.

## Rollback

Remove the new module, export entries, focused tests, spike evidence, and story
evidence updates.
