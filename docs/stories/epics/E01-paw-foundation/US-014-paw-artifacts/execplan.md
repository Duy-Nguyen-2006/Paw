
# Execution Plan

## Steps

1. Add an artifact module under `packages/coding-agent/src/paw/`.
2. Export public artifact types and helpers from the Paw barrel.
3. Add focused tests with temporary `.paw/artifacts` directories.
4. Run the focused Paw artifact tests.
5. Run `npm run check`.
6. Update Harness story evidence and trace.

## Guardrails

- No `any`.
- No inline imports.
- Use existing project path resolver.
- No sub-agent execution.
- Do not commit.

## Rollback

Remove the new module, export entries, and focused tests. Runtime data created
by tests lives in temporary directories.
