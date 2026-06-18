
# Execution Plan

1. Add `worker-blocked-result.ts` with `blockPawWorkerResult`.
2. Add focused worker-blocked-result tests for blocked, needs-user-decision, and
   no-write failure branches.
3. Export the helper and result types from the Paw package index.
4. Add story evidence and test-matrix coverage.
5. Verify with focused Vitest, Harness story verification, and root
   `npm run check`.

## Non-Goals

- Worker retry policy.
- Reviewer or verifier blocked handling.
- Journal writes.
- CLI resume routing.
