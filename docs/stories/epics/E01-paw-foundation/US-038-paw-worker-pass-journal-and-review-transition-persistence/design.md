# Design

## Domain Model

US-038 adds a small application-level helper over existing Paw primitives:

- `getPawSessionLockStatus` checks live lock state before any session read.
- Current lock ownership uses the same default owner shape as task-session:
  `pid` defaults to `process.pid`, and `host` defaults to `hostname()`.
- `readPawSessionState` loads the locked state.
- `transitionPawSessionState` validates `IMPLEMENTING -> REVIEWING` before any
  writes.
- `appendPawSliceJournalEntry` persists accepted worker evidence.
- `writePawSessionState` atomically persists the review state after journal
  appends.

No durable schema fields are added.

## Application Flow

The helper flow is:

1. Read lock status.
2. Return `not_locked` for missing or stale locks without reading state.
3. Return `locked_by_other` for a live lock owned by another pid or host without
   reading state.
4. Read session state.
5. Return `invalid_state` unless the state is `IMPLEMENTING`.
6. Return `no_selected_slice` when `current_slice_id` is null.
7. Validate worker output agent, session id, slice id, changed-file paths, and
   changed-file content hashes.
8. Return `worker_not_passed` for non-`pass` worker status.
9. Validate the review transition.
10. Build journal entries from `changed_files`, preserving `apply_method` when
    present and using the supplied or current ISO timestamp.
11. Append journal entries in worker output order.
12. Write the `REVIEWING` state.
13. Return lock, previous state, next state, worker output, and journal entries.

## Safety Boundaries

The helper does not acquire, reclaim, refresh, or release locks. It does not run
sub-agents, inspect the worktree, apply edits, compute hashes, or create
checkpoints.

State advances only after lock ownership, state, worker output, and transition
checks pass. Validation and transition failures do not write state or journal
entries.

## Alternatives Considered

1. Reuse `advancePawTaskSession` and append the journal afterward.
   - Rejected because the story requires journal evidence before state advances
     to `REVIEWING`.
2. Write state before journal append.
   - Rejected because resume would see `REVIEWING` without accepted worker-pass
     evidence.
3. Reject empty `changed_files`.
   - Rejected because no-op worker passes are valid when the selected slice
     requires no file changes.
