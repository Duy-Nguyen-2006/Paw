# Design

## Domain Model

US-043 adds a reviewer blocked-state helper over existing Paw primitives:

- `getPawSessionLockStatus` checks live lock state before any session read.
- Current lock ownership uses `pid` and `host`, defaulting to `process.pid` and
  `hostname()`.
- `readPawSessionState` loads the locked state.
- `PawSubAgentOutput.blocked_reason.code` maps to `BLOCKED_<code>`.
- `transitionPawSessionState` validates the blocked transition and records
  `resume_state`.
- `writePawSessionState` atomically persists the blocked state.

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
8. Return `reviewer_not_blocked` for non-blocked reviewer statuses.
9. Validate blocked reason code, message, and suggested action.
10. Transition to `BLOCKED_<code>`.
11. Write the blocked state.
12. Return lock, previous state, next state, and reviewer output.

## Safety Boundaries

The helper does not run reviewers, modify journals, create checkpoints, release
locks, or touch git state.

State writes happen only after lock ownership, state, output, blocked-reason,
and transition checks pass.

## Alternatives Considered

1. Reuse `completePawReviewerPass`.
   - Rejected because blocked output has a different state transition and must
     not move the slice to verification.
2. Treat all non-pass reviewer outputs as blocked.
   - Rejected because `fail` and retry policy require separate semantics.
