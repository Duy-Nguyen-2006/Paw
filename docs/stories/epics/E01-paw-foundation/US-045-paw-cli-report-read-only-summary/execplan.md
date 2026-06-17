# Execution Plan

1. Add a failing focused report-command test for read-only summary printing and
   argument validation.
2. Implement `report-command.ts` with structured result and formatting helpers.
3. Route `paw report` in the Paw command dispatcher and update help text.
4. Export report command helpers from the Paw package index.
5. Add story and test-matrix evidence.
6. Verify with focused Vitest, Harness story verification, and root
   `npm run check`.

## Non-Goals

- Final report emission.
- Latest-session discovery.
- JSON output mode.
- Full orchestrator report routing.
