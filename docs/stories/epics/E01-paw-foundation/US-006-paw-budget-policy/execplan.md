# Execution Plan

## Steps

1. Add a pure budget policy module under `packages/coding-agent/src/paw/`.
2. Export public budget types and helpers from the Paw barrel.
3. Add focused unit tests for task and slice budget decisions.
4. Run the focused Paw budget tests.
5. Run `npm run check`.
6. Update Harness story evidence and trace.

## Guardrails

- No `any`.
- No inline imports.
- No CLI behavior changes.
- No hardcoded budget values when the loaded config supplies them.
- Do not commit.

## Rollback

Remove the new module, export entries, and focused tests. No persistent runtime
data is affected.
