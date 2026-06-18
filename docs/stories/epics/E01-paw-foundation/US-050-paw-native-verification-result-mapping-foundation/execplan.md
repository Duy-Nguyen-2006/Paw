
# Execution Plan

1. Add a failing focused test for native verification result mapping.
2. Implement `verification-runner.ts` with pure mapping semantics.
3. Export the mapping helper from the Paw package index.
4. Add story and test-matrix evidence.
5. Verify with focused Vitest, Harness story verification, adjacent
   plan/runner/verify tests, GitNexus detect-changes, and root `npm run check`.

## Non-Goals

- Wiring the mapper into `paw verify` CLI.
- Real shell command execution.
- Sandbox enforcement.
- Parallel native verifier execution.
- CLI output formatting of mapped results.
