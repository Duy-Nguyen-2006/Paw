
# Execution Plan

## Steps

1. Add a plan-slices module under `packages/coding-agent/src/paw/`.
2. Export public plan-slice types and helpers from the Paw barrel.
3. Add focused tests for ordering, duplicates, empty plans, and invalid fields.
4. Run the focused Paw plan-slice tests.
5. Run the focused Paw suite through US-019.
6. Run `npm run check`.
7. Update Harness story evidence and trace.

## Guardrails

- No `any`.
- No inline imports.
- Keep this helper pure and deterministic.
- No orchestrator loop wiring.
- Do not commit.

## Rollback

Remove the new module, export entries, and focused tests.
