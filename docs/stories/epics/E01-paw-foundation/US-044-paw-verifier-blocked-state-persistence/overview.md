# US-044: Paw Verifier Blocked State Persistence

## Summary

Persist the blocked verifier boundary for a selected Paw slice. The helper
requires a live current session lock, validates verifier blocked decisions, maps
the blocked reason code to the matching `BLOCKED_*` state, and writes the
blocked session state.

## Scope

- Add a core verifier-blocked-result helper.
- Support verifier blocked decisions.
- Preserve the current slice id and resume state in blocked metadata.
- Return structured no-write results for lock, state, blocked reason, and
  transition failures.
- Leave verifier retry policy and CLI resume routing to later slices.

## Acceptance Criteria

- A verifier blocked decision in `VERIFYING` persists the matching `BLOCKED_*`
  state.
- Missing/stale/foreign locks do not read or write state beyond the lock check.
- Wrong state, missing current slice, and invalid blocked reason do not write
  state.
- Focused tests, Harness story verification, and root `npm run check` pass.
