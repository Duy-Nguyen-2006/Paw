# Execution Plan

## Steps

1. Add a pure context budget module under `packages/coding-agent/src/paw/`.
2. Export public context budget types and helpers from the Paw barrel.
3. Add focused unit tests for cap lookup and budget decisions.
4. Run the focused Paw context budget tests.
5. Run `npm run check`.
6. Update Harness story evidence and trace.

## Guardrails

- No `any`.
- No inline imports.
- No CLI behavior changes.
- Use `PawRuntimeConfig["context"]` and `PawRuntimeConfig["prompt_cache"]`.
- Do not commit.

## Rollback

Remove the new module, export entries, and focused tests. No persistent runtime
data is affected.
