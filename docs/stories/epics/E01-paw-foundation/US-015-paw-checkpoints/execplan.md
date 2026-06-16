# Execution Plan

## Steps

1. Add a checkpoint module under `packages/coding-agent/src/paw/`.
2. Export public checkpoint types and helpers from the Paw barrel.
3. Add focused tests with temporary `.paw/checkpoints` directories.
4. Run the focused Paw checkpoint tests.
5. Run the focused Paw suite through US-015.
6. Run `npm run check`.
7. Update Harness story evidence and trace.

## Guardrails

- No `any`.
- No inline imports.
- Use existing project path resolver and atomic JSON write helper.
- No user git mutation.
- No rollback execution.
- Do not commit.

## Rollback

Remove the new module, export entries, and focused tests. Runtime data created
by tests lives in temporary directories.
