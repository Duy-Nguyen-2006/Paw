
# Design

## Domain Model

US-040 adds a small helper over existing Paw primitives:

- `getPawSessionLockStatus` checks live lock state before any session read.
- Current lock ownership uses the same default owner shape as task-session:
  `pid` defaults to `process.pid`, and `host` defaults to `hostname()`.
- `readPawSessionState` loads the locked state.
- `PawVerifyGateDecision` represents verifier gate outcomes.
- `transitionPawSessionState` validates and applies `VERIFYING -> SLICE_DONE`.
- `writePawSessionState` atomically persists the slice-done state.

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
7. Require at least one verification decision.
8. Validate the slice-done transition.
9. Write the `SLICE_DONE` state.
10. Return `completed` when all decisions are verified, or
    `completed_with_unverified` when any gate is unverified.

## Safety Boundaries

The helper does not acquire, reclaim, refresh, or release locks. It does not run
verifier commands, create final reports, append journals, create checkpoints, or
touch git state.

State advances only after lock ownership, state, decision, and transition
checks pass. Failure branches do not write state.

## Alternatives Considered

1. Require every gate to be verified.
   - Rejected because Paw explicitly supports completion with disclosed
     unverified gates when a gate cannot run.
2. Allow an empty decision list.
   - Rejected because advancing to `SLICE_DONE` without any verifier evidence
     would hide missing verification.
