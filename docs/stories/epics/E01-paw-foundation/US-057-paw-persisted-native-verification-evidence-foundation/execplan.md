# Execution Plan

1. Add a failing focused test confirming that `PawSessionPaths` includes
   `verificationEvidenceFile` resolving to
   `.paw/sessions/<id>/verification-evidence.json`.
2. Add a failing focused test confirming that `writePawVerificationEvidence`
   writes a `PawNativeVerificationRunResult[]` array to the evidence file and
   `readPawVerificationEvidence` reads it back with identical content.
3. Add a failing focused test confirming that `writePawVerificationEvidence`
   with an empty array writes `[]` and `readPawVerificationEvidence` returns
   `[]`.
4. Add a failing focused test confirming that `readPawVerificationEvidence`
   returns `[]` when the evidence file does not exist.
5. Add a failing focused test confirming that `writePawVerificationEvidence`
   uses `writePawJsonAtomic` (crash-safe atomic write).
6. Add a failing focused test confirming that `createPawVerifyCommandResult`
   with a native executor persists the run results to the evidence file after
   completion.
7. Add a failing focused test confirming that `createPawVerifyCommandResult`
   without a native executor persists `[]` to the evidence file.
8. Add `verificationEvidenceFile` to `PawSessionPaths` and
   `resolvePawSessionPaths` in `session-store.ts`.
9. Add `writePawVerificationEvidence` and `readPawVerificationEvidence` to
   `session-store.ts`, importing `PawNativeVerificationRunResult` from
   `verification-runner.ts`.
10. In `createPawVerifyCommandResult` in `verify-command.ts`, after the
    completed/completed_with_unverified branch, call
    `writePawVerificationEvidence(repoRoot, sessionId, nativeVerificationRunResults)`
    before returning the result.
11. Run focused Vitest, Harness story verification, adjacent
    session-store/verify-command/verification-runner tests, and root
    `npm run check`.

## Non-Goals

- Changing the `PawNativeVerificationRunResult` type shape.
- Changing `PawSessionState` or `state.json` format.
- Rendering verification evidence into `summary.md` or any markdown output.
- Adding a `--verbose` flag to `paw report` for raw evidence rendering.
- Per-slice evidence files.
- Integrating evidence reading into the orchestrator's final-report assembly
  (future work connecting readPawVerificationEvidence to
  PawFinalReportInput.nativeVerificationRunResults).
- Evidence retention or cleanup integration with US-020.
- Modifying the verification runner (US-049), executor (US-052), or
  verify-command result shape (US-055).
