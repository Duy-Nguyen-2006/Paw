
# Execution Plan

1. Add a failing focused verify-command test for `VERIFYING` session completion,
   unverified gate disclosure, lock release, live-lock reporting, missing state,
   invalid state, and CLI routing.
2. Implement `verify-command.ts` with structured result and formatting helpers.
3. Route `paw verify` in the Paw command dispatcher and update help text.
4. Export verify command helpers from the Paw package index.
5. Add story and test-matrix evidence.
6. Verify with focused Vitest, Harness story verification, adjacent verifier/CLI
   tests, GitNexus detect-changes, and root `npm run check`.

## Non-Goals

- Running native verifier commands.
- Parallel verifier execution.
- Final report emission.
- JSON output mode.
