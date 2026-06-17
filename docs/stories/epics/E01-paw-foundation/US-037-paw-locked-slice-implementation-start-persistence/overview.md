# Overview

## Current Behavior

Paw can persist selected-slice state and checkpoint metadata under a current
session lock. Runtime callers do not yet have a small core helper that marks a
locked selected slice as ready for worker execution.

## Target Behavior

`beginPawSliceImplementation` accepts a repository root, session id, and
optional lock options.

The helper advances the session from `SLICE_SELECT` to `IMPLEMENTING` by
delegating to `advancePawTaskSession` with `{ to: "IMPLEMENTING" }`. This keeps
lock ownership checks, stale lock rejection, transition validation, and atomic
state writes inside the existing task-session helper.

On success, the helper returns the selected slice id from
`nextState.current_slice_id` and the underlying advance result. It preserves
pending and completed slice ids through the transition.

Failure results are structured and do not write state:

- `not_locked` for missing or stale locks.
- `locked_by_other` for live locks owned by another pid or host.
- `no_selected_slice` when `SLICE_SELECT` has no `current_slice_id`.
- `invalid_transition` for source states that cannot enter `IMPLEMENTING`.

## Affected Users

- Paw runtime implementers wiring the worker start boundary.
- Resume implementers that need persisted state before worker execution.
- CLI implementers who will later route the multi-slice loop without duplicating
  transition and lock checks.

## Affected Product Docs

- `docs/product/paw-runtime.md`

## Non-Goals

- Running worker execution.
- Appending slice journal entries.
- Creating checkpoint metadata or snapshots.
- Touching the user's git branch, index, stash, or working tree.
- Changing session-store, task-session, state-machine, or CLI behavior.
