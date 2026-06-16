# Execution Plan

## Steps

1. Add a retention policy module under `packages/coding-agent/src/paw/`.
2. Export public retention types and helpers from the Paw barrel.
3. Add focused tests for session count retention and artifact age retention.
4. Run the focused Paw retention policy tests.
5. Run the focused Paw suite through US-020.
6. Run `npm run check`.
7. Update Harness story evidence and trace.

## Guardrails

- No `any`.
- No inline imports.
- Pure planning only; no filesystem deletion.
- Do not commit.

## Rollback

Remove the new module, export entries, and focused tests.
