# US-075: Paw Build Slice-Advance Orchestration Foundation

## Summary

Extend `paw build <session-id> --once` so it can advance coordinator states around slice execution by reusing existing slice selection and begin-implementation command helpers.

## Scope

- Dispatch `PLAN_APPROVED` and `SLICE_DONE` sessions to existing slice selection logic.
- Dispatch `SLICE_SELECT` sessions to existing begin-implementation logic.
- Preserve existing worker, reviewer, and verifier one-step build behavior for `IMPLEMENTING`, `REVIEWING`, and `VERIFYING`.
- Keep the command bounded to exactly one state transition per `--once`.
- Do not emit final reports or run real provider execution from this slice.

## Acceptance Criteria

- `PLAN_APPROVED` sessions with pending slices advance to `SLICE_SELECT` and select the next slice.
- `SLICE_SELECT` sessions with a selected slice advance to `IMPLEMENTING`.
- `SLICE_DONE` sessions with pending slices advance to `SLICE_SELECT` for the next slice.
- `SLICE_DONE` sessions without pending slices return `no_pending_slices` without mutation.
- Existing worker, reviewer, and verifier build paths remain covered and passing.
