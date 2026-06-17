# US-063: Paw CLI Slice Selection Foundation

## Summary

Add `paw select-slice <session-id>` as a bounded CLI foundation that acquires
the session lock, calls `selectNextPawPlanSlice`, and releases an owned lock
before returning.

## Scope

- Add `slice-selection-command.ts` with parser, result builder, formatting, and
  `runPawSelectSliceCommand`.
- Route `paw select-slice` through `handlePawCommand` before the normal agent runtime.
- Report structured outcomes including `advanced`, `no_pending_slices`,
  `missing_project`, `missing_session`, `locked`, `invalid_transition`,
  `not_locked`, and `locked_by_other`.
- Export select-slice helpers from `packages/coding-agent/src/paw/index.ts`.
- Add focused tests and Harness story documentation.

## Acceptance Criteria

- `PLAN_APPROVED` and `SLICE_DONE` sessions with pending slices advance to
  `SLICE_SELECT` with the next pending slice id persisted.
- `no_pending_slices` is returned without mutating session state when the queue is empty.
- Owned locks acquired by the command are released for advanced, no_pending,
  invalid, not_locked, and locked_by_other outcomes after acquire.
- Live foreign locks at acquire time are reported and not released.
- Help, missing session id, session ids beginning with `-`, extra args, and unknown
  options set `exitCode = 1` without throwing.
- Focused tests listed in validation pass.
