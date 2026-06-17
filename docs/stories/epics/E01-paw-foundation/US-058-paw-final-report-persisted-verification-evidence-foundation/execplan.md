# Execution Plan

1. Add a failing focused test confirming that `emitPawFinalReport` called
   without `nativeVerificationRunResults` on the report input reads the
   persisted evidence file and forwards the results into the completed report.
2. Add a failing focused test confirming that `emitPawFinalReport` called
   without `nativeVerificationRunResults` and with no evidence file on disk
   produces a report with `native_verification_run_results` as `[]`.
3. Add a failing focused test confirming that `emitPawFinalReport` called with
   explicit `nativeVerificationRunResults` on the report input uses the
   caller-supplied value even when a persisted evidence file exists.
4. Add a failing focused test confirming that `emitPawFinalReport` called with
   explicit `nativeVerificationRunResults: []` suppresses persisted evidence
   (caller wins with empty array).
5. Add a failing focused test confirming that the rendered markdown
   `## Verification Evidence` section reflects the resolved evidence (from
   persisted file or caller) without raw stdout, stderr, exit codes, commands,
   or reasons.
6. In `emitPawFinalReport` in `final-report-emission.ts`, after the
   pending-slice check and before `createFinalReport`, add the evidence
   resolution block that checks `input.reportInput.nativeVerificationRunResults`
   and falls back to `readPawVerificationEvidence(input.repoRoot, input.sessionId)`.
7. Spread the resolved `nativeVerificationRunResults` into the `reportInput`
   passed to `createFinalReport`.
8. Import `readPawVerificationEvidence` from `session-store.ts` in
   `final-report-emission.ts`.
9. Run focused Vitest, Harness story verification, adjacent
   final-report-emission/final-report/session-store tests, and root
   `npm run check`.

## Non-Goals

- Changing `PawFinalReportEmissionInput`, `PawFinalReportInput`,
  `PawFinalReport`, or any type signature.
- Changing `createPawFinalReport`, `renderPawFinalReportMarkdown`,
  `readPawVerificationEvidence`, or `writePawVerificationEvidence`.
- Changing the verification runner, executor, plan, or verify command.
- Changing `PawSessionState` or `state.json`.
- Adding a `--verbose` flag to `paw report` for raw evidence rendering.
- Per-slice evidence files.
- Evidence retention or cleanup integration with US-020.
- Rendering raw stdout, stderr, exit codes, commands, or reasons in markdown.
