# Execution Plan

1. Add a failing focused runner test using a fake executor.
2. Implement `verification-runner.ts` with injected executor semantics.
3. Export runner types and helpers from the Paw package index.
4. Add story and test-matrix evidence.
5. Verify with focused Vitest, Harness story verification, adjacent plan/verify
   tests, GitNexus detect-changes, and root `npm run check`.

## Non-Goals

- Real shell command execution.
- CLI `paw verify` runner wiring.
- Sandbox enforcement.
- Parallel native verifier execution.
- Build/test command execution in tests.
