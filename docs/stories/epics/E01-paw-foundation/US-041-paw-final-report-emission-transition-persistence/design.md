# Design

## Domain Model

US-041 adds a helper over existing Paw primitives:

- `getPawSessionLockStatus` checks live lock state before any session read.
- Current lock ownership uses the same default owner shape as task-session:
  `pid` defaults to `process.pid`, and `host` defaults to `hostname()`.
- `readPawSessionState` loads the locked state.
- `createPawFinalReport` and `renderPawFinalReportMarkdown` assemble the final
  report.
- `transitionPawSessionState` validates `SLICE_DONE -> FINAL_REPORT`.
- `writePawSessionState` atomically persists the final-report state.

The emitted markdown is stored at the session summary path already defined by
`resolvePawSessionPaths`.

## Application Flow

The helper flow is:

1. Read lock status.
2. Return `not_locked` for missing or stale locks without reading state.
3. Return `locked_by_other` for a live lock owned by another pid or host without
   reading state.
4. Read session state.
5. Return `invalid_state` unless the state is `SLICE_DONE`.
6. Return `pending_slices` when pending slices remain.
7. Assemble and render the final report.
8. Validate the `FINAL_REPORT` transition.
9. Write `summary.md`.
10. Write the `FINAL_REPORT` state.
11. Return lock, previous state, next state, report, markdown, and summary path.

## Safety Boundaries

The helper does not acquire, reclaim, refresh, or release locks. It does not run
verifier commands, route CLI output, create sub-agent artifacts, or touch git
state.

Summary and state writes happen only after lock ownership, state, pending-slice,
report-input, and transition checks pass.

## Alternatives Considered

1. Write final reports under `.paw/artifacts`.
   - Rejected because the existing artifact contract is sub-agent-role oriented,
     while the session already has a canonical `summary.md`.
2. Allow final report emission with pending slices.
   - Rejected because the state machine guard requires all planned slices to be
     complete before `FINAL_REPORT`.
