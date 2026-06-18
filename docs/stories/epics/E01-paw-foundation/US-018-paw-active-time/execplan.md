
# Execution Plan

## Steps

1. Add an active-time module under `packages/coding-agent/src/paw/`.
2. Export public active-time types and helpers from the Paw barrel.
3. Add focused tests for enabled, disabled, open, and invalid segments.
4. Run the focused Paw active-time tests.
5. Run the focused Paw suite through US-018.
6. Run `npm run check`.
7. Update Harness story evidence and trace.

## Guardrails

- No `any`.
- No inline imports.
- Use config-derived pause states.
- No orchestrator wiring or persistence.
- Do not commit.

## Rollback

Remove the new module, export entries, and focused tests.
