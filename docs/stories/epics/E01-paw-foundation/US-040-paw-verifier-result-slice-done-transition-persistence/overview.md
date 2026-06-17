# US-040: Paw Verifier Result Slice-Done Transition Persistence

## Summary

Persist the verifier boundary for a selected Paw slice. The helper requires a
live current session lock, accepts explicit verification gate decisions, and
advances `VERIFYING` to `SLICE_DONE`.

## Scope

- Add a core verifier-result helper for the verification-completion path.
- Distinguish fully verified completion from completion with unverified gates.
- Preserve pending slices while moving the current slice into
  `completed_slice_ids`.
- Return structured no-write results for lock, state, decision, and transition
  failures.
- Leave actual verifier command execution, final report aggregation, and CLI
  routing to later slices.

## Acceptance Criteria

- Verified decisions advance `VERIFYING` to `SLICE_DONE`.
- Unverified decisions advance with a `completed_with_unverified` status and
  preserve disclosure metadata for later reporting.
- Empty decisions, missing/stale/foreign locks, wrong state, and missing current
  slice do not write state.
- Focused tests, Harness story verification, and root `npm run check` pass.
