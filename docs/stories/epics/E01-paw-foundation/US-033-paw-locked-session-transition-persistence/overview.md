# Overview

## Current Behavior

Paw can start or resume a task session under a durable lock, and session state
can be read, validated, transitioned, and written atomically. There is not yet a
single core helper that advances an existing task session only when the caller
already owns the live session lock.

Without that helper, future runtime callers would need to duplicate lock-owner
checks before persisting transitions, increasing the risk that a stale,
missing, or foreign lock is silently bypassed.

## Target Behavior

`advancePawTaskSession` advances a persisted Paw task session through a supplied
`PawStateTransition` only when `.paw/sessions/<id>/session.lock` is live and
owned by the current caller. It returns structured outcomes:

- `advanced` with previous and next state when the lock is owned and the
  transition is valid.
- `invalid_transition` with validation issues when the lock is owned but the
  state-machine transition is invalid, without writing state.
- `not_locked` when the lock is missing or stale, without reclaiming the lock
  or writing state.
- `locked_by_other` when a live lock belongs to another owner, without writing
  state.

Malformed session state remains an exceptional condition surfaced by existing
state readers.

## Affected Users

- Paw runtime implementers wiring future task execution under a session lock.
- CLI implementers who will later call core runtime helpers without duplicating
  lock-owner checks.
- Reviewers validating persistence semantics without invoking provider-backed
  orchestration.

## Affected Product Docs

- `docs/product/paw-runtime.md`

## Non-Goals

- Adding or routing CLI commands.
- Editing `packages/coding-agent/src/main.ts`.
- Running the full Paw orchestrator loop.
- Implementing user-facing CLI resume.
- Reclaiming or acquiring locks from the transition helper.
