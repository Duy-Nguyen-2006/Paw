# US-055: Paw Verify Native Run Evidence Foundation

## Summary

Expose per-gate native verification runner results on the completed verify
command result so that future reporting, debugging, and tooling can inspect
exit codes, summarized stdout/stderr, and failure reasons for each gate that
was executed. The default non-executing path (no `--native` flag) does not
include run results, preserving the distinction between executed and
non-executed verification.

## Scope

- Add a `nativeVerificationRunResults` field to
  `PawVerifyCommandCompletedResult` typed as
  `readonly PawNativeVerificationRunResult[]`.
- When `createPawVerifyCommandResult` receives a `nativeVerificationExecutor`,
  capture the `PawNativeVerificationRunResult[]` returned by
  `runPawNativeVerificationPlan` and store it on the completed result.
- When no executor is provided (the default non-executing path), set
  `nativeVerificationRunResults` to an empty array.
- Update `formatPawVerifyCommandResult` to render a concise one-line summary
  of executed gates: `native executed gates: gate(status), ...` when results
  are present and at least one gate was executed. When no gates were executed
  or the array is empty, render `native executed gates: none`.
- Export `PawNativeVerificationRunResult` from the Paw package index if it
  is not already exported, so consumers can inspect individual gate results.

## Acceptance Criteria

- When `paw verify <session-id> --native` completes successfully, the
  `PawVerifyCommandCompletedResult.nativeVerificationRunResults` array
  contains one entry per planned gate with `exitCode`, `stdout`, `stderr`,
  `executed`, and `command` fields populated.
- When `paw verify <session-id>` runs without `--native`, the
  `nativeVerificationRunResults` array is empty.
- The formatted output for `--native` results renders a concise summary line
  listing each executed gate name and status (e.g.
  `native executed gates: gate1(verified), gate2(unverified)`).
- The formatted output for the non-executing path renders
  `native executed gates: none`.
- `paw-verification-runner` tests covering `runPawNativeVerificationPlan`
  continue to pass unchanged.
- Focused tests, Harness story verification, and root `npm run check` pass.
