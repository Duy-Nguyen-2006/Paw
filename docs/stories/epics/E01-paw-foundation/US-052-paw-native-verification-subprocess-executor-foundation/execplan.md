
# Execution Plan

1. Add a failing focused test for subprocess executor behavior: a real
   `echo` command succeeds with exit code 0 and captured output; a known
   failing command returns non-zero exit code; a sleep command exceeding the
   timeout is killed with `timedOut: true`; and a non-existent command
   produces an error result.
2. Implement `verification-executor.ts` with `createPawNativeSubprocessExecutor`
   factory, child process spawning, timeout watchdog, stream capture, and
   cleanup.
3. Export the executor factory and its options type from the Paw package
   index.
4. Add story and test-matrix evidence.
5. Verify with focused Vitest, Harness story verification, adjacent
   runner/plan/verify tests, GitNexus detect-changes, and root
   `npm run check`.

## Non-Goals

- Wiring the executor into the default CLI.
- Command allowlist or AGENTS command-policy integration.
- Sandbox (bwrap/Landlock) enforcement.
- Parallel gate execution.
- Environment variable or per-gate working directory overrides.
- Signal forwarding beyond the timeout kill.
