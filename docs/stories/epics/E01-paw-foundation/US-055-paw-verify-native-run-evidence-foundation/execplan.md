# Execution Plan

1. Add a failing focused test confirming that when
   `createPawVerifyCommandResult` is called with a native executor the
   completed result includes a `nativeVerificationRunResults` array with one
   entry per planned gate, each carrying `exitCode`, `stdout`, `stderr`, and
   `executed` fields matching the mock executor output.
2. Add a failing focused test confirming that when no executor is provided the
   completed result includes an empty `nativeVerificationRunResults` array.
3. Add a failing focused test for `formatPawVerifyCommandResult`: when run
   results are present and contain executed gates the formatted output contains
   a `native executed gates: gate(status), ...` summary line; when the array
   is empty or contains no executed gates the output reads
   `native executed gates: none`.
4. Add a failing focused test confirming the non-executing path output is
   byte-identical to the pre-US-055 format (regression guard).
5. Add `nativeVerificationRunResults` to `PawVerifyCommandCompletedResult` in
   `verify-command.ts`.
6. In `createPawVerifyCommandResult`, after `runPawNativeVerificationPlan`
   returns, store the raw `PawNativeVerificationRunResult[]` on the completed
   result alongside the existing `verifyDecisions`. In the non-executing branch,
   set the field to `[]`.
7. Update `formatPawVerifyCommandResult` to render the concise executed-gates
   summary line via `formatNativeExecutedGateNames`.
8. Verify `PawNativeVerificationRunResult` is exported from the Paw package
   index; add the export if missing.
9. Run focused Vitest, Harness story verification, adjacent
   verification-runner/verification-plan/verify-command tests, and root
   `npm run check`.

## Non-Goals

- Changing the `PawNativeVerificationRunResult` type shape.
- Adding `--json` output mode.
- Writing run evidence to persistent files or the final report.
- Changing `PawVerifyGateDecision` to include execution evidence.
- Modifying the verification runner (US-049), executor (US-052), or command
  policy (US-054).
- Parallel gate execution.
- Per-gate working directory or environment overrides.
- Rendering detailed per-gate exit codes, stdout, stderr, or reasons in the
  text formatter (deferred to future detailed reporting tooling).
