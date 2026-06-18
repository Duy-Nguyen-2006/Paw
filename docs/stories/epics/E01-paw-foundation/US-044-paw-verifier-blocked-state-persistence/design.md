
# Design

## Domain Model

US-044 adds a verifier blocked-state helper over existing Paw primitives:

- `getPawSessionLockStatus` checks live lock state before any session read.
- Current lock ownership uses `pid` and `host`, defaulting to `process.pid` and
  `hostname()`.
- `readPawSessionState` loads the locked state.
- A blocked verifier decision carries a blocked reason code, message, and
  suggested action.
- The reason code maps to `BLOCKED_<code>`.
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
5. Return `invalid_state` unless the state is `VERIFYING`.
6. Return `no_selected_slice` when `current_slice_id` is null.
7. Validate the blocked reason code, message, and suggested action.
8. Transition to `BLOCKED_<code>`.
9. Write the blocked state.
10. Return lock, previous state, and next state.

## Safety Boundaries

The helper does not run verifier commands, create final reports, release locks,
or touch git state.

State writes happen only after lock ownership, state, blocked-reason, and
transition checks pass.

## Alternatives Considered

1. Reuse `completePawVerification`.
   - Rejected because blocked verifier decisions do not complete the slice.
2. Encode verifier blocked state as `done_with_unverified`.
   - Rejected because unrecoverable gate absence differs from resumable blocked
     failure.
