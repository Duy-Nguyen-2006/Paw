
# Design

## Domain Model

US-036 adds a small application-level helper over existing Paw primitives:

- `getPawSessionLockStatus` provides lock liveness and stale-lock detection.
- `readPawSessionState` provides the selected slice after lock ownership is
  proven.
- `createPawCheckpointName` provides deterministic checkpoint names.
- `writePawCheckpointMetadata` validates and atomically persists metadata.

The helper does not add a durable schema. It creates the existing checkpoint
metadata shape with `scope: "slice"` and the selected `current_slice_id`.

## Application Flow

The helper flow is:

1. Read current lock status with caller-provided `lockOptions`.
2. Return `not_locked` for missing or stale locks.
3. Compare lock owner to `lockOptions.pid` and `lockOptions.host`, defaulting to
   `process.pid` and `hostname()` like task-session helpers.
4. Return `locked_by_other` for foreign live locks.
5. Read session state only after the live owned lock check.
6. Return `invalid_state` unless the state is `SLICE_SELECT`.
7. Return `no_selected_slice` when `current_slice_id` is null.
8. Build the checkpoint name from timestamp, current slice id, and short id.
9. Write checkpoint metadata and return the metadata, paths, state, and lock.

## Safety Boundaries

The helper intentionally does not acquire, reclaim, refresh, or release locks.
It also does not inspect or mutate git state. Metadata persistence remains
limited to `.paw/checkpoints/`.

No session state is read before proving lock ownership, so lock failures keep
precedence over state-derived outcomes.

## Alternatives Considered

1. Let callers assemble checkpoint metadata directly.
   - Rejected because future orchestrator callers would need to repeat lock
     owner checks and selected-slice validation.
2. Delegate through `advancePawTaskSession`.
   - Rejected because checkpoint preparation is a read-and-write metadata step,
     not a state transition.
3. Create the shadow worktree in the same helper.
   - Rejected because US-036 is metadata preparation only; snapshot creation and
     rollback execution remain separate runtime slices.
