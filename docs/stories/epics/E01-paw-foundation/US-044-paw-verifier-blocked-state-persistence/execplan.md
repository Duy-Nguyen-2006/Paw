
# Execution Plan

1. Add `verifier-blocked-result.ts` with `blockPawVerifierResult`.
2. Add focused verifier-blocked-result tests for blocked and no-write failure
   branches.
3. Export the helper and result types from the Paw package index.
4. Add story evidence and test-matrix coverage.
5. Verify with focused Vitest, Harness story verification, and root
   `npm run check`.

## Non-Goals

- Verifier retry policy.
- CLI resume routing.
