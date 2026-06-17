# Execution Plan

1. Add `verifier-result.ts` with `completePawVerification`.
2. Add focused verifier-result tests for verified, unverified, and no-write
   failure branches.
3. Export the helper and result types from the Paw package index.
4. Add story evidence and test-matrix coverage.
5. Verify with focused Vitest, Harness story verification, and root
   `npm run check`.

## Non-Goals

- Running verifier commands.
- Final report aggregation.
- Journal or checkpoint writes.
- CLI routing.
