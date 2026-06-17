# US-056: Paw Report Native Verification Evidence Foundation

## Summary

Extend the final report model and markdown renderer to carry per-gate native
verification evidence produced by US-055. When native verification was executed,
the report surfaces disclose which gates ran and their verification status.
Raw per-gate stdout/stderr, exit codes, commands, and reasons are stored on the
typed report model for programmatic consumers but are not rendered in the
default markdown output, keeping the report concise for day-to-day use.

## Scope

- Add a `nativeVerificationRunResults` field to `PawFinalReportInput` typed as
  `readonly PawNativeVerificationRunResult[]`, optional with a default of `[]`.
- Add a corresponding `native_verification_run_results` field to `PawFinalReport`
  typed as `readonly PawNativeVerificationRunResult[]`.
- In `createPawFinalReport`, propagate the input run results to the report
  model. When the field is absent or empty, store `[]`.
- Update `renderPawFinalReportMarkdown` to render a new
  `## Verification Evidence` section that lists each executed gate with its
  status (e.g. `working_tree_baseline: verified`, `dep_diff: unverified`).
  When no native gates were executed (empty array or no executed entries),
  render `## Verification Evidence` with `- No native verification gates executed`.
- Update `PawFinalReportEmissionInput.reportInput` to accept the new optional
  field and forward it through `createPawFinalReport`.
- Raw stdout, stderr, exit codes, commands, and reasons remain on the typed
  `PawFinalReport` model but are **not** rendered in the default markdown. No
  `--verbose` flag is added in this story.

## Acceptance Criteria

- When `PawFinalReportInput` includes `nativeVerificationRunResults` with
  executed gates, the returned `PawFinalReport.native_verification_run_results`
  contains the same entries.
- When `nativeVerificationRunResults` is absent or empty,
  `PawFinalReport.native_verification_run_results` is `[]`.
- `renderPawFinalReportMarkdown` includes a `## Verification Evidence` section
  listing each executed gate name and status when gates were executed.
- The `## Verification Evidence` section renders `- No native verification gates
  executed` when the run results array is empty or contains no executed entries.
- The default markdown output does **not** include raw stdout, stderr, exit
  code text, commands, or reasons from native verification runs.
- `PawFinalReportEmission` accepts and forwards the new field through to
  `createPawFinalReport` when present on the emission input.
- Focused tests, Harness story verification, and root `npm run check` pass.
