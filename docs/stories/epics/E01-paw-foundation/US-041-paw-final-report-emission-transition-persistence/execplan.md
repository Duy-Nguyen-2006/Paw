# Execution Plan

1. Add `final-report-emission.ts` with `emitPawFinalReport`.
2. Add focused final-report-emission tests for success, unverified disclosure,
   and no-write failure branches.
3. Export the helper and result types from the Paw package index.
4. Add story evidence and test-matrix coverage.
5. Verify with focused Vitest, Harness story verification, and root
   `npm run check`.

## Non-Goals

- CLI report routing.
- End-to-end Paw task execution.
- Sub-agent artifact writes.
- Lock release.
