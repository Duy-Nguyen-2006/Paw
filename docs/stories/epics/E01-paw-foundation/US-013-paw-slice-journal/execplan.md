
# Execution Plan

## Steps

1. Add a slice journal module under `packages/coding-agent/src/paw/`.
2. Export public journal types and helpers from the Paw barrel.
3. Add focused unit tests with temporary `.paw` session directories.
4. Run the focused Paw slice journal tests.
5. Run `npm run check`.
6. Update Harness story evidence and trace.

## Guardrails

- No `any`.
- No inline imports.
- Use existing session path validation/resolution.
- No patch application or rollback logic.
- Do not commit.

## Rollback

Remove the new module, export entries, and focused tests. Runtime data created
by tests lives in temporary directories.
