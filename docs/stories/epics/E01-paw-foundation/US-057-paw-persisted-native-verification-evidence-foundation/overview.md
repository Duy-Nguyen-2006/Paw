
# US-057: Paw Persisted Native Verification Evidence Foundation

## Summary

Persist native verification run results from `paw verify --native` to a
durable JSON file in the session directory so that the future orchestrator,
final report assembly, and CLI reporting can read per-gate execution evidence
across process boundaries. The file stores typed
`PawNativeVerificationRunResult[]` data; raw stdout, stderr, exit codes,
commands, and reasons are carried in the persisted JSON but are not rendered
in any markdown output by default.

## Scope

- Add `verificationEvidenceFile` to `PawSessionPaths` in `session-store.ts`,
  resolving to `.paw/sessions/<id>/verification-evidence.json`.
- Add `writePawVerificationEvidence(repoRoot, sessionId, results)` to
  `session-store.ts`. The function atomically writes the
  `PawNativeVerificationRunResult[]` array to the evidence file using
  `writePawJsonAtomic`. When the array is empty the function writes `[]`.
- Add `readPawVerificationEvidence(repoRoot, sessionId)` to `session-store.ts`.
  The function reads and parses the evidence file, returning
  `PawNativeVerificationRunResult[]`. When the file does not exist it returns
  `[]`.
- In `verify-command.ts`, after `createPawVerifyCommandResult` completes with
  status `completed` or `completed_with_unverified`, call
  `writePawVerificationEvidence` to persist the native run results to disk.
  When no executor was used (non-executing path), the function writes `[]`.
- Import `PawNativeVerificationRunResult` from `verification-runner.ts` in
  `session-store.ts` for the new function signatures.
- The persisted JSON is a typed array, not rendered markdown. No stdout, stderr,
  exit codes, commands, or reasons appear in the persisted markdown summary
  file.

## Acceptance Criteria

- After `paw verify <session-id> --native` completes, the file
  `.paw/sessions/<id>/verification-evidence.json` exists and contains a JSON
  array of `PawNativeVerificationRunResult` entries with populated `gate`,
  `status`, `executed`, `command`, `exitCode`, `stdout`, `stderr`, and
  `verified` fields.
- After `paw verify <session-id>` runs without `--native`, the evidence file
  contains `[]`.
- `readPawVerificationEvidence` returns the persisted entries when the file
  exists and `[]` when the file does not exist.
- `writePawVerificationEvidence` uses `writePawJsonAtomic` for crash-safe
  writes.
- `PawSessionPaths.verificationEvidenceFile` resolves correctly for a given
  session id.
- The persisted evidence file does not alter the existing `state.json` shape
  or the `PawSessionState` type.
- Focused tests, Harness story verification, and root `npm run check` pass.
