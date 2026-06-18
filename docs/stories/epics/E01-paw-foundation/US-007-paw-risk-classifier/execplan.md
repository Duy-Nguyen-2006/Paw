
# Execution Plan

## Steps

1. Add a pure risk classifier module under `packages/coding-agent/src/paw/`.
2. Export public classifier types and helpers from the Paw barrel.
3. Add focused unit tests for risk scoring and conservative task classes.
4. Run the focused Paw classifier tests.
5. Run `npm run check`.
6. Update Harness story evidence and trace.

## Guardrails

- No `any`.
- No inline imports.
- No CLI behavior changes.
- Use `PawRuntimeConfig["routing"]["trivial_requires_all"]` for trivial checks.
- Do not commit.

## Rollback

Remove the new module, export entries, and focused tests. No persistent runtime
data is affected.
