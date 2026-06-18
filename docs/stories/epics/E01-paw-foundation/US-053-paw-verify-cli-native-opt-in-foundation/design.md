
# Design

## Domain Model

US-053 modifies only `runPawVerifyCommand` in `verify-command.ts`:

- The args parsing logic gains a `--native` flag check.
- When `--native` is present, the CLI constructs a
  `PawNativeSubprocessExecutor` via `createPawNativeSubprocessExecutor({ cwd })`
  and passes it on the `PawVerifyCommandInput.nativeVerificationExecutor` field
  that US-051 introduced.
- When `--native` is absent, no executor is passed, and the existing
  non-executing path runs unchanged.
- No new types or functions are exported. The wiring is purely CLI-local.

## Application Flow

1. User runs `paw verify <session-id> --native`.
2. `runPawVerifyCommand` extracts the session id and detects `--native` in the
   remaining args.
3. A subprocess executor is created with `process.cwd()` as the working
   directory.
4. `createPawVerifyCommandResult` is called with
   `{ nativeVerificationExecutor: executor }`.
5. The function (from US-051) runs the native verification plan through the
   runner (US-049) using the subprocess executor (US-052), maps outcomes
   (US-050), and persists verified or unverified gate decisions.
6. The formatted result is printed to stdout.

When `--native` is absent, the flow is unchanged: `createPawVerifyCommandResult`
is called without an executor, and all gates are marked unverified with plan
reasons.

## Argument Parsing

The `runPawVerifyCommand` args parser currently accepts exactly one positional
argument (the session id). US-053 adds a second accepted flag:

```text
paw verify <session-id> [--native]
paw verify [--native] <session-id> --help
paw verify -h
```

Parsing order:
1. If any arg is `--help` or `-h`, print help and return (regardless of other args).
2. If no args remain after removing known flags (`--native`, `--help`, `-h`),
   print missing-session error.
3. If any remaining arg starts with `-`, reject it as an unknown option.
4. If more than one positional arg remains, reject the second as an unknown option.
5. Otherwise the single positional arg is the session id.

## Safety Boundaries

- The `--native` flag is the sole opt-in mechanism. Without it, the CLI never
  spawns child processes.
- The subprocess executor uses `shell: false` (US-052) to prevent shell
  injection.
- No command allowlist or sandbox enforcement is added in this slice; those
  remain separate concerns.
- No new environment variable or configuration opt-in is introduced; the flag
  is explicit and per-invocation.
- The executor factory is constructed fresh per invocation; no global state
  mutation occurs.

## Alternatives Considered

1. Add `--native` as a config flag in `paw.yaml`.
   - Rejected because a per-invocation CLI flag is more explicit and safer for
     incremental rollout. Config-level opt-in can be added in a future slice.
2. Wire the executor directly in `createPawVerifyCommandResult`.
   - Rejected because the CLI entry point is the correct place for
     user-facing opt-in. The input type already supports executor injection
     for programmatic callers who choose their own policy.
3. Use a `--executor` flag that accepts a module path.
   - Rejected because the subprocess executor (US-052) is the only
     implementation and accepting arbitrary modules would be a security risk
     without sandbox enforcement.
