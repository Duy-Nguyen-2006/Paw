# US-041: Paw Final Report Emission Transition Persistence

## Summary

Persist the final-report boundary for a completed Paw task. The helper requires
a live current session lock, assembles the final report, writes the session
summary markdown, and advances `SLICE_DONE` to `FINAL_REPORT`.

## Scope

- Add a core final-report emission helper.
- Write final report markdown to `.paw/sessions/<id>/summary.md`.
- Require no pending slices before final-report transition.
- Return structured no-write results for lock, state, pending-slice,
  report-input, and transition failures.
- Leave CLI report routing and full end-to-end Paw task execution to later
  slices.

## Acceptance Criteria

- `SLICE_DONE` with no pending slices emits summary markdown and advances to
  `FINAL_REPORT`.
- Reports with unverified gates preserve `done_with_unverified` disclosure.
- Missing, stale, or foreign locks do not read or write state beyond the lock
  check.
- Pending slices, wrong state, and invalid report input do not write summary or
  state.
- Focused tests, Harness story verification, and root `npm run check` pass.
