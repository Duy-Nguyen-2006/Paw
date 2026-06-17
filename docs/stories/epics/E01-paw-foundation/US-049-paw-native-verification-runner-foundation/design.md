# Design

## Domain Model

US-049 introduces `verification-runner.ts`:

- `PawNativeVerificationExecutor` is an injected async adapter. It receives gate,
  command argv, and timeout seconds.
- `PawNativeVerificationExecutorResult` reports exit code, stdout, stderr, and
  whether the command timed out.
- `PawNativeVerificationRunResult` is either verified or unverified and includes
  execution metadata plus an explicit reason for unverified outcomes.
- `summarizeNativeVerificationOutput` bounds stdout/stderr returned to callers.

## Application Flow

1. A caller creates a native verification plan from configured gates.
2. The runner iterates entries in order.
3. Unsupported entries are returned as unverified without executor calls.
4. Planned entries call the injected executor with timeout metadata.
5. Timeout results become unverified timeout outcomes.
6. Exit code `0` becomes verified.
7. Any other exit code becomes unverified with summarized stdout/stderr.

## Safety Boundaries

This slice does not wire the runner into `paw verify`, does not spawn native
processes, does not run package scripts, and does not mark real project gates as
verified. Shell execution, sandbox enforcement, and command allowlist policy are
future integration slices.

## Alternatives Considered

1. Implement a Node child-process executor in the same slice.
   - Rejected to keep process execution policy, sandboxing, and AGENTS command
     constraints separate from the result semantics.
2. Throw on non-zero exit codes.
   - Rejected because SPEC requires degraded/unverified gates to be reported
     explicitly instead of crashing or falsely passing.
