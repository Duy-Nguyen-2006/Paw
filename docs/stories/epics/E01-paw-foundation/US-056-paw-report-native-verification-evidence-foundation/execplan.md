# Execution Plan

1. Add a failing focused test confirming that when `createPawFinalReport` is
   called with `nativeVerificationRunResults` containing executed gates, the
   returned `PawFinalReport.native_verification_run_results` contains the same
   entries.
2. Add a failing focused test confirming that when `nativeVerificationRunResults`
   is absent or empty, `PawFinalReport.native_verification_run_results` is `[]`.
3. Add a failing focused test for `renderPawFinalReportMarkdown`: when run
   results contain executed gates the rendered output includes a
   `## Verification Evidence` section listing each executed gate name and
   status; when the array is empty or contains no executed entries the section
   reads `- No native verification gates executed`.
4. Add a failing focused test confirming the default markdown output does not
   contain raw stdout, stderr, exit code text, commands, or reasons from the
   run results.
5. Add a failing focused test confirming that `PawFinalReportEmission` forwards
   `nativeVerificationRunResults` from the emission input through to the
   assembled report and persisted markdown.
6. Add `nativeVerificationRunResults` as an optional field to
   `PawFinalReportInput` in `final-report.ts`.
7. Add `native_verification_run_results` to `PawFinalReport` in `final-report.ts`.
8. In `createPawFinalReport`, store `input.nativeVerificationRunResults ?? []`
   on the report model.
9. In `renderPawFinalReportMarkdown`, add the `## Verification Evidence` section
   using `renderVerificationEvidence` that filters to executed entries and
   renders `<gate>: <status>` for executed gates.
10. Verify that `PawFinalReportEmission` already forwards the field through its
    existing `reportInput` spread. Add a focused emission test confirming the
    round-trip.
11. Run focused Vitest, Harness story verification, adjacent
    final-report/final-report-emission/verify-command tests, and root
    `npm run check`.

## Non-Goals

- Changing the `PawNativeVerificationRunResult` type shape.
- Adding a `--verbose` or `--debug` flag to render raw stdout/stderr/exit codes, commands, or reasons.
- Writing verification evidence to separate artifact files.
- Modifying the verification runner (US-049), executor (US-052), or
  verify-command (US-055).
- Changing the orchestrator's final-report assembly call site (future work
  connecting the verify-command result to the report input).
- Parallel gate execution.
- Per-gate working directory or environment overrides.
