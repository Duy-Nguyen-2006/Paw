# Execution Plan

## Steps

1. Add a scout benchmark evaluator under `packages/coding-agent/src/paw/`.
2. Export public benchmark types and helper from the Paw barrel.
3. Add focused tests for PASS and each KILL threshold.
4. Add S4 spike evidence and update the spike tracker.
5. Run focused Paw scout benchmark tests.
6. Run the focused Paw suite through US-024.
7. Run `npm run check`.
8. Update Harness story evidence and trace.

## Guardrails

- No `any`.
- No inline imports.
- No shell benchmark execution in this slice.
- Do not commit.

## Rollback

Remove the new module, export entries, focused tests, spike evidence, and story
evidence updates.
