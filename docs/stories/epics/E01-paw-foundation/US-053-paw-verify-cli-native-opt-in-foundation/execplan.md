
# Execution Plan

1. Add a failing focused test for `--native` flag parsing in the verify
   command: `paw verify <session-id> --native` creates a subprocess executor
   and injects it; the result includes verified gate decisions for zero-exit
   gates and unverified decisions for non-zero-exit gates.
2. Add a focused test confirming the non-executing path is preserved when
   `--native` is omitted.
3. Add focused tests for edge cases: `--native` without a session id prints
   an error; `--native --help` prints help; unknown flag-like args (`--bad`)
   are rejected as errors; `--help` alongside a session id prints help;
   `--native + session + --help` prints help.
4. Update `runPawVerifyCommand` in `verify-command.ts` to parse `--native`
   from the args array, construct a `PawNativeSubprocessExecutor`, and pass
   it to `createPawVerifyCommandResult`.
5. Update `printPawVerifyHelp` to document the `--native` flag.
6. Add story and test-matrix evidence.
7. Verify with focused Vitest, Harness story verification, adjacent
   runner/executor/verify tests, GitNexus detect-changes, and root
   `npm run check`.

## Non-Goals

- Modifying `createPawVerifyCommandResult` or its input type.
- Adding command allowlist or AGENTS command-policy integration.
- Sandbox (bwrap/Landlock) enforcement.
- Config-level native opt-in via `paw.yaml`.
- Parallel gate execution.
- Per-gate working directory or environment overrides.
