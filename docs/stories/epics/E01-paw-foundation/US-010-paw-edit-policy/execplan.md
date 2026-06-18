
# Execution Plan

## Steps

1. Add a pure edit policy module under `packages/coding-agent/src/paw/`.
2. Export public edit policy types and helpers from the Paw barrel.
3. Add focused unit tests for fallback and idempotency decisions.
4. Run the focused Paw edit policy tests.
5. Run `npm run check`.
6. Update Harness story evidence and trace.

## Guardrails

- No `any`.
- No inline imports.
- No patch application or file I/O.
- Use `PawRuntimeConfig["edit"]`.
- Do not commit.

## Rollback

Remove the new module, export entries, and focused tests. No persistent runtime
data is affected.
