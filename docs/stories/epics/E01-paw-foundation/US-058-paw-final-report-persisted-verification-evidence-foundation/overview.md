
# US-058: Paw Final Report Emission Consumes Persisted Native Verification Evidence

## Summary

Wire `emitPawFinalReport` to read persisted native verification evidence from
`.paw/sessions/<id>/verification-evidence.json` (US-057) when the caller does
not supply `nativeVerificationRunResults` on `PawFinalReportEmissionInput`.
Explicit caller-provided evidence always wins. When neither the caller nor the
persisted file provides evidence, the result is `[]` and the rendered markdown
remains concise with no raw stdout, stderr, exit codes, commands, or reasons.

## Scope

- In `emitPawFinalReport` (`final-report-emission.ts`), after the state and
  pending-slice checks pass but before `createFinalReport` is called, resolve
  the effective `nativeVerificationRunResults`:
  1. If `input.reportInput.nativeVerificationRunResults` is defined (even if
     `[]`), use it unchanged.
  2. Otherwise, call `readPawVerificationEvidence(input.repoRoot, input.sessionId)`
     and use the returned array.
- Spread the resolved value into the `reportInput` passed to
  `createFinalReport` so that `createPawFinalReport` receives
  `nativeVerificationRunResults` on its input.
- Import `readPawVerificationEvidence` from `session-store.ts` in
  `final-report-emission.ts`.
- No changes to `PawFinalReportEmissionInput`, `PawFinalReportInput`,
  `createPawFinalReport`, `renderPawFinalReportMarkdown`,
  `readPawVerificationEvidence`, or `writePawVerificationEvidence`.
- No changes to the verification runner, executor, plan, or verify command.

## Acceptance Criteria

- When `emitPawFinalReport` is called without `nativeVerificationRunResults` on
  the report input and the evidence file exists with persisted gate results, the
  completed result's `report.native_verification_run_results` contains the
  persisted entries.
- When `emitPawFinalReport` is called without `nativeVerificationRunResults` on
  the report input and the evidence file does not exist,
  `report.native_verification_run_results` is `[]`.
- When `emitPawFinalReport` is called with explicit
  `nativeVerificationRunResults` on the report input, the completed result's
  `report.native_verification_run_results` contains the caller-supplied entries
  regardless of what the evidence file contains.
- The rendered `summary.md` `## Verification Evidence` section matches the
  resolved evidence and does not include raw stdout, stderr, exit codes,
  commands, or reasons.
- Existing final-report-emission behavior for lock, state, pending-slice,
  report-input, and transition failure results is unchanged.
- Focused tests, Harness story verification, and root `npm run check` pass.
