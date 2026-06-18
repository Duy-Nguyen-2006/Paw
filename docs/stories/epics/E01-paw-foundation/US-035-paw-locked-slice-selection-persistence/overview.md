
# Overview

## Current Behavior

Paw can approve a planner slice queue into persisted `pending_slice_ids` under
the current session lock. The lower-level state machine can also transition from
`PLAN_APPROVED` or `SLICE_DONE` into `SLICE_SELECT`, popping the next pending
slice into `current_slice_id`.

There is not yet a single core helper that performs locked next-slice selection
for future orchestrator callers.

## Target Behavior

`selectNextPawPlanSlice` accepts a repository root, session id, and optional
lock options. It delegates lock ownership and state persistence to
`advancePawTaskSession` with a `SLICE_SELECT` transition.

When a pending slice exists, the helper persists `SLICE_SELECT`, returns the
selected slice id, removes it from pending slices, and preserves completed
slice ids. When no pending slices exist from a valid slice-selection source
state, it returns `no_pending_slices` and leaves state unchanged. Lock and
invalid-transition failures are propagated without writes.

## Affected Users

- Paw runtime implementers wiring the multi-slice loop.
- Resume-flow implementers who must avoid redoing completed slices.
- CLI implementers who will later route slice selection without duplicating
  lock and transition result handling.

## Affected Product Docs

- `docs/product/paw-runtime.md`

## Non-Goals

- Adding or routing CLI commands.
- Editing `packages/coding-agent/src/main.ts`.
- Running worker, reviewer, or verifier agents.
- Implementing final-report transition when no slices remain.
- Acquiring, reclaiming, or removing locks inside the selection helper.
