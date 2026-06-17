# US-053: Paw Verify CLI Native Execution Opt-in Foundation

## Summary

Add an explicit `--native` flag to the `paw verify` CLI command so that
`paw verify <session-id> --native` creates and injects a subprocess executor
(from US-052) into `createPawVerifyCommandResult`, causing real native
verification gates to execute. Without the flag, `paw verify <session-id>`
remains non-executing, preserving the existing foundation behavior.

## Scope

- Parse `--native` from the args array in `runPawVerifyCommand`.
- When `--native` is present, create a `PawNativeSubprocessExecutor` via
  `createPawNativeSubprocessExecutor` with the current working directory and
  pass it as the `nativeVerificationExecutor` field on
  `PawVerifyCommandInput`.
- When `--native` is absent, pass no executor, preserving the existing
  non-executing path where all gates are marked unverified with plan reasons.
- Update the help text to document the `--native` flag.
- Export no new types; the executor factory and input type already exist.
- Keep `createPawVerifyCommandResult` unchanged; opt-in wiring lives entirely
  in the CLI entry point.

## Acceptance Criteria

- `paw verify <session-id> --native` injects the subprocess executor and
  executes planned native verification gates.
- `paw verify <session-id>` without `--native` remains non-executing.
- If any arg is `--help` or `-h`, the command prints help and does not execute,
  regardless of other args (e.g. `paw verify <session-id> --help`,
  `paw verify --native <session-id> -h`).
- `paw verify --native` without a session id prints an error.
- Unknown flag-like args (e.g. `--bad`) produce an error, not a session id.
- The help text documents `--native`.
- Focused tests and root `npm run check` pass.
