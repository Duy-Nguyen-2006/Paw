
# Design

## Domain Model

US-052 introduces `verification-executor.ts`:

- `createPawNativeSubprocessExecutor` accepts an options bag with a
  working directory and returns a `PawNativeVerificationExecutor`.
- Internally, each executor invocation spawns a child process via
  `child_process.spawn` with `argv[0]` as the command and `argv.slice(1)` as
  arguments, using `shell: false` to avoid shell injection.
- A `setTimeout` watchdog enforces the `timeoutSec` budget from the executor
  input. On timeout, the child process is killed via `SIGKILL`.
- stdout and stderr are captured via stream concatenation into strings.
- The returned `PawNativeVerificationExecutorResult` contains `exitCode`,
  `stdout`, `stderr`, and `timedOut`.

## Application Flow

1. A caller creates the subprocess executor with the project working directory.
2. The executor is passed into `createPawVerifyCommandResult` (via the
   `nativeVerificationExecutor` field introduced in US-051) or into
   `runPawNativeVerificationPlan` directly.
3. For each planned gate, the runner calls the executor with command argv,
   gate name, and timeout seconds.
4. The executor spawns the child process, starts the timeout watchdog, and
   streams stdout/stderr into buffers.
5. On normal exit: the watchdog is cleared, streams are finalized, and the
   result is returned with the exit code.
6. On timeout: the child is killed, `timedOut: true` is set, and partial output
   is returned.
7. On spawn error: the result is returned with a non-zero exit code and the
   error message in stderr.
8. The runner or caller summarizes the output via the existing
   `summarizeNativeVerificationOutput` contract.

## Safety Boundaries

- `shell: false` prevents shell injection; commands are not interpolated.
- The executor does not implement a command allowlist; that remains a future
  integration slice.
- The executor does not implement sandbox (bwrap/Landlock) enforcement; that
  is a separate concern per ADR-18.
- The executor does not wire itself into the default CLI; callers must
  explicitly construct and inject it.
- No AGENTS command-policy integration is performed in this slice.
- The executor does not manage environment variables, working directory
  overrides per gate, or signal forwarding beyond the timeout kill.

## Alternatives Considered

1. Use `execFile` instead of `spawn`.
   - Rejected because `spawn` provides streaming stdout/stderr capture with
     bounded memory usage, while `execFile` buffers the entire output in memory
     before resolving.
2. Implement command allowlist in this slice.
   - Rejected because SPEC command-policy integration, AGENTS constraint
     enforcement, and sandbox policy belong to separate slices per the safety
     boundary pattern established in US-048 through US-051.
3. Implement parallel gate execution in this slice.
   - Rejected because the runner (US-049) already controls iteration order.
     Parallel execution of the plan is a future optimization that must respect
     SPEC's parallel-native-processes contract (SPEC §16) with separate
     concurrency policy.
4. Use `AbortController` / `AbortSignal` for timeout.
   - Rejected because `child_process.spawn` in current Node.js does not
     natively accept `AbortSignal`; a `setTimeout` + `process.kill` pattern
     is the established bounded approach.
