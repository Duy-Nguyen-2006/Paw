
# Execution Plan

1. Add a failing focused resume-command test for existing session lock acquire,
   lock release, stale-lock reclamation, live-lock reporting, missing state, and
   CLI routing.
2. Implement `resume-command.ts` with structured result and formatting helpers.
3. Route `paw resume` in the Paw command dispatcher and update help text.
4. Export resume command helpers from the Paw package index.
5. Add story and test-matrix evidence.
6. Verify with focused Vitest, Harness story verification, adjacent Paw CLI
   tests, GitNexus detect-changes, and root `npm run check`.

## Non-Goals

- Full orchestrator resume execution.
- Worker/reviewer/verifier command execution.
- Checkpoint or rollback execution.
- JSON output mode.
