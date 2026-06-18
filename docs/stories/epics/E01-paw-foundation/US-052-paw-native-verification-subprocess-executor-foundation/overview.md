
# US-052: Paw Native Verification Subprocess Executor Foundation

## Summary

Add a bounded child-process executor adapter implementing
`PawNativeVerificationExecutor` so that future `paw verify` integration can
spawn real native verification commands with timeout enforcement and output
capture. The default CLI remains not wired to this executor.

## Scope

- Implement a `createPawNativeSubprocessExecutor` factory that returns
  a `PawNativeVerificationExecutor`.
- Spawn child processes via `child_process.spawn` with the provided command
  argv and working directory.
- Enforce the per-gate timeout by killing the child process group when the
  timeout elapses, reporting `timedOut: true`.
- Capture stdout and stderr as strings up to a bounded character limit.
- Return `PawNativeVerificationExecutorResult` with exit code, captured output,
  and timeout flag.
- Ensure child process cleanup on all exit paths (normal exit, error, timeout).
- Export the executor factory from the Paw package index.
- Keep the default CLI entry point (`runPawVerifyCommand`) non-executing.

## Acceptance Criteria

- The executor spawns a child process with the provided command argv and
  returns the exit code, stdout, and stderr.
- A zero exit code produces `exitCode: 0` with no timeout.
- A non-zero exit code produces the correct exit code with captured output.
- A command that exceeds the timeout is killed and produces `timedOut: true`.
- stdout and stderr are captured as strings.
- No orphan child processes remain after executor returns.
- The executor conforms to the `PawNativeVerificationExecutor` type without
  type casts or `any` annotations.
- The default CLI path does not use the subprocess executor.
- No production code outside the executor module invokes shell commands
  directly in this slice.
- Focused tests, Harness story verification, and root `npm run check` pass.
