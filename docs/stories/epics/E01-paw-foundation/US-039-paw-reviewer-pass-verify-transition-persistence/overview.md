# US-039: Paw Reviewer Pass Verify Transition Persistence

## Summary

Persist the accepted reviewer-pass boundary for a selected Paw slice. The helper
requires a live current session lock, validates reviewer output for the active
slice, and advances `REVIEWING` to `VERIFYING`.

## Scope

- Add a core reviewer-result helper for the pass path.
- Preserve pending and completed slice metadata during transition.
- Return structured no-write results for lock, state, output, and transition
  failures.
- Leave reviewer fail/block handling, verifier execution, checkpoint creation,
  and CLI routing to later slices.

## Acceptance Criteria

- A reviewer pass output for the current slice advances `REVIEWING` to
  `VERIFYING`.
- Missing, stale, or foreign locks do not read or write session state beyond the
  lock check.
- Wrong state, missing selected slice, output mismatch, and non-pass reviewer
  status do not write state.
- Focused tests, Harness story verification, and root `npm run check` pass.
