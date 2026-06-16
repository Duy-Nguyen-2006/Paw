# Execution Plan

## Steps

1. Add a sub-agent response policy module under `packages/coding-agent/src/paw/`.
2. Export public response types and helpers from the Paw barrel.
3. Add focused tests for accepted, retry, blocked, and metadata mismatch paths.
4. Run the focused Paw sub-agent response tests.
5. Run the focused Paw suite through US-016.
6. Run `npm run check`.
7. Update Harness story evidence and trace.

## Guardrails

- No `any`.
- No inline imports.
- Reuse existing sub-agent JSON parser and validation types.
- No provider or sub-agent execution.
- Do not commit.

## Rollback

Remove the new module, export entries, and focused tests.
