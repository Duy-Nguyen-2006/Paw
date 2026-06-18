
# Design

## Domain Model

US-039 adds a small helper over existing Paw primitives:

- `getPawSessionLockStatus` checks live lock state before any session read.
- Current lock ownership uses the same default owner shape as task-session:
  `pid` defaults to `process.pid`, and `host` defaults to `hostname()`.
- `readPawSessionState` loads the locked state.
- `transitionPawSessionState` validates `REVIEWING -> VERIFYING`.
- `writePawSessionState` atomically persists the verify state.

No durable schema fields are added.

## Application Flow

The helper flow is:

1. Read lock status.
2. Return `not_locked` for missing or stale locks without reading state.
3. Return `locked_by_other` for a live lock owned by another pid or host without
   reading state.
4. Read session state.
5. Return `invalid_state` unless the state is `REVIEWING`.
6. Return `no_selected_slice` when `current_slice_id` is null.
7. Validate reviewer output agent, session id, and slice id.
8. Return `reviewer_not_passed` for non-`pass` reviewer status.
9. Validate the verify transition.
10. Write the `VERIFYING` state.
11. Return lock, previous state, next state, and reviewer output.

## Safety Boundaries

The helper does not acquire, reclaim, refresh, or release locks. It does not run
reviewers or verifiers, inspect the worktree, apply edits, append journal
entries, or create checkpoints.

State advances only after lock ownership, state, reviewer output, and transition
checks pass. Failure branches do not write state.

## Alternatives Considered

1. Fold reviewer fail/block handling into this helper.
   - Rejected because fail/block branches need blocked-state mapping and user
     decision semantics that should be explicit in a later slice.
2. Reuse `advancePawTaskSession` directly.
   - Rejected because this boundary must validate reviewer output before
     writing the state transition.
