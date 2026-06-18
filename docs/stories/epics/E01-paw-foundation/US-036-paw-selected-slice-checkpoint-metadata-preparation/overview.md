
# Overview

## Current Behavior

Paw can persist checkpoint metadata and can persist selected-slice state under a
current session lock. Runtime callers do not yet have a single helper that
combines the current selected slice, lock ownership, deterministic checkpoint
name creation, and checkpoint metadata persistence.

## Target Behavior

`preparePawSliceCheckpoint` accepts a repository root, session id, base tree,
changed files, short id, timestamp, optional notes, and optional session lock
options.

The helper checks the session lock first and reads session state only when the
lock is live and owned by the caller. It requires `SLICE_SELECT` with a
non-null `current_slice_id`, writes `.paw/checkpoints/<session>/<checkpoint>/checkpoint.json`
with slice-scoped metadata, and returns the metadata, checkpoint paths, state,
and lock used for the write.

Failure results are structured and do not write metadata:

- `not_locked` for unlocked or stale locks.
- `locked_by_other` for live locks owned by another pid or host.
- `invalid_state` for a session state other than `SLICE_SELECT`.
- `no_selected_slice` for `SLICE_SELECT` without `current_slice_id`.

## Affected Users

- Paw runtime implementers wiring the per-slice worker loop.
- Resume and rollback implementers that need stable metadata before future
  shadow snapshot and rollback execution slices.
- CLI implementers who will later route checkpoint preparation without
  duplicating lock and state checks.

## Affected Product Docs

- `docs/product/paw-runtime.md`

## Non-Goals

- Creating shadow worktrees or snapshots.
- Touching the user's git branch, index, stash, or working tree.
- Changing session-store, task-session, checkpoint writer, or state-machine
  behavior.
- Adding CLI routing.
