
# Execution Plan

## Steps

1. Add a final report module under `packages/coding-agent/src/paw/`.
2. Export public report types and helpers from the Paw barrel.
3. Add focused tests for done, done-with-unverified, degraded, and markdown.
4. Run the focused Paw final report tests.
5. Run the focused Paw suite through US-017.
6. Run `npm run check`.
7. Update Harness story evidence and trace.

## Guardrails

- No `any`.
- No inline imports.
- Reuse existing `PawDegradedStep` and `PawVerifyGateDecision` types.
- No CLI wiring or file persistence.
- Do not commit.

## Rollback

Remove the new module, export entries, and focused tests.
