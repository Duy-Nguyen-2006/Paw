# US-065: Paw CLI Slice Implementation Start Foundation

## Summary

Add `paw begin-implementation <session-id>` as a bounded CLI foundation that acquires
the session lock, calls `beginPawSliceImplementation`, and releases an owned lock
before returning.

## Scope

- Add `slice-implementation-command.ts` with parser, result builder, formatting, and
  `runPawBeginImplementationCommand`.
- Route `paw begin-implementation` through `handlePawCommand` before the normal agent runtime.
- Report structured outcomes including `advanced`, `no_selected_slice`,
  `missing_project`, `missing_session`, `locked`, `invalid_transition`,
  `not_locked`, and `locked_by_other`.
- Export begin-implementation helpers from `packages/coding-agent/src/paw/index.ts`.
- Add focused tests and Harness story documentation.

## Acceptance Criteria

- `SLICE_SELECT` sessions with a selected slice advance to `IMPLEMENTING` with the
  current slice id persisted.
- `no_selected_slice` is returned without mutating session state when
  `current_slice_id` is null in `SLICE_SELECT`.
- Owned locks acquired by the command are released for advanced, no_selected_slice,
  invalid, not_locked, and locked_by_other outcomes after acquire.
- Live foreign locks at acquire time are reported and not released.
- Help, missing session id, session ids beginning with `-`, extra args, and unknown
  options set `exitCode = 1` without throwing.
- Focused tests listed in validation pass.
