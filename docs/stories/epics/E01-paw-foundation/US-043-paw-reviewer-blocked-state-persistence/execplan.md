# Execution Plan

1. Add `reviewer-blocked-result.ts` with `blockPawReviewerResult`.
2. Add focused reviewer-blocked-result tests for blocked, needs-user-decision,
   and no-write failure branches.
3. Export the helper and result types from the Paw package index.
4. Add story evidence and test-matrix coverage.
5. Verify with focused Vitest, Harness story verification, and root
   `npm run check`.

## Non-Goals

- Reviewer fail/retry policy.
- Verifier blocked handling.
- CLI resume routing.
