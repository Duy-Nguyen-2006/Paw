
# Execution Plan

1. Add a failing focused test for native verification gate planning.
2. Implement the pure `verification-plan.ts` mapping module.
3. Integrate the plan into `paw verify` result construction and formatting while
   keeping gate decisions unverified.
4. Export the planning types and helpers from the Paw package index.
5. Update story and test-matrix evidence.
6. Verify with focused Vitest, Harness story verification, adjacent verify tests,
   GitNexus detect-changes, and root `npm run check`.

## Non-Goals

- Executing native commands.
- Marking gates verified.
- Parallel verifier execution.
- Shell sandboxing or timeout enforcement.
- JSON output mode.
