
# US-060: Paw CLI Final Report Emission Foundation

## Summary

Add `paw finalize <session-id> --summary <text> [--evidence <text>]...` as a
bounded CLI foundation that emits the final report for an existing
`SLICE_DONE` session via `emitPawFinalReport`, persists `summary.md` and
`report.json`, and advances session state to `FINAL_REPORT`.

## Scope

- Add `finalize-command.ts` with argument parsing, `createPawFinalizeCommandResult`,
  formatting, and `runPawFinalizeCommand`.
- Route `paw finalize` through `handlePawCommand` before the normal agent runtime.
- Check `.paw` and `state.json` before acquiring the session lock (same pattern as
  verify/resume).
- Acquire lock, call `emitPawFinalReport` with summary, evidence (default
  `manual finalization requested` when no `--evidence`), and empty
  `verifyDecisions`, then release lock when owned by this process.
- Export finalize helpers from `packages/coding-agent/src/paw/index.ts`.
- Add focused tests and Harness story documentation.

## Acceptance Criteria

- Completed finalize on `SLICE_DONE` writes `summary.md` and `report.json` and
  advances to `FINAL_REPORT`.
- Wrong state, pending slices, invalid report input, and invalid transition do not
  write report artifacts.
- Live foreign locks are reported and not released.
- Missing `.paw`, missing session, help, missing session id, missing/blank
  summary, missing/blank evidence values, and unknown options set `exitCode = 1`
  without throwing.
- Focused tests listed in validation pass.
