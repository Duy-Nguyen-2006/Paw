
# Execution Plan

## Steps

1. Add a resilience drill evaluator under `packages/coding-agent/src/paw/`.
2. Export public drill types and helper from the Paw barrel.
3. Add focused tests for PASS and each KILL condition.
4. Add S5 spike evidence and update the spike tracker.
5. Run focused Paw resilience drill tests.
6. Run the focused Paw suite through US-025.
7. Run `npm run check`.
8. Update Harness story evidence and trace.

## Guardrails

- No `any`.
- No inline imports.
- No live provider/network calls.
- Do not weaken existing resilience policy behavior.
- Do not commit.

## Rollback

Remove the new module, export entries, focused tests, spike evidence, and story
evidence updates.
