# Execution Plan

## Steps

1. Add a cost/latency/cache evaluator under `packages/coding-agent/src/paw/`.
2. Export public evaluator types and helper from the Paw barrel.
3. Add focused tests for PASS, USD KILL, token KILL, active-time KILL, hosted
   cache advisory warning, and local cache N/A.
4. Add S2 spike evidence and update the spike tracker.
5. Run focused Paw cost/latency/cache tests.
6. Run the focused Paw suite through US-026.
7. Run `npm run check`.
8. Update Harness story evidence and trace.

## Guardrails

- No `any`.
- No inline imports.
- No live provider, billing, or prompt-cache calls.
- Do not turn advisory cache data into a hard gate.
- Do not commit.

## Rollback

Remove the new module, export entries, focused tests, spike evidence, and story
evidence updates.
