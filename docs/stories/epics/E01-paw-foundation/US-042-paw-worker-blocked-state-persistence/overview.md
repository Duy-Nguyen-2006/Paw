
# US-042: Paw Worker Blocked State Persistence

## Summary

Persist the blocked worker boundary for a selected Paw slice. The helper
requires a live current session lock, validates blocked worker output, maps the
blocked reason code to the matching `BLOCKED_*` state, and writes the blocked
session state.

## Scope

- Add a core worker-blocked-result helper.
- Support worker `blocked` and `needs_user_decision` outputs.
- Preserve the current slice id and resume state in blocked metadata.
- Return structured no-write results for lock, state, output, blocked reason,
  and transition failures.
- Leave worker fail/retry policy, reviewer blocked handling, and CLI resume
  routing to later slices.

## Acceptance Criteria

- Blocked worker output in `IMPLEMENTING` persists the matching `BLOCKED_*`
  state.
- `needs_user_decision` maps to `BLOCKED_NEEDS_USER_DECISION`.
- Missing/stale/foreign locks do not read or write state beyond the lock check.
- Wrong state, missing current slice, metadata mismatch, non-blocked output, and
  invalid blocked reason do not write state.
- Focused tests, Harness story verification, and root `npm run check` pass.
