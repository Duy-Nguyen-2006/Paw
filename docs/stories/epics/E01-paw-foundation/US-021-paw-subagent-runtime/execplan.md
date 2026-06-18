
# Execution Plan

## Steps

1. Add a `subagent-runtime` module under `packages/coding-agent/src/paw/`.
2. Export public runtime types and helpers from the Paw barrel.
3. Add focused tests for accepted, retry, blocked, and oversized handoff paths.
4. Run focused Paw sub-agent runtime tests.
5. Run the focused Paw suite through US-021.
6. Run `npm run check`.
7. Update Harness story evidence and trace.

## Guardrails

- No `any`.
- No inline imports.
- Pure runtime boundary only; no provider or process execution.
- Do not commit.

## Rollback

Remove the new module, export entries, focused tests, and story evidence.
