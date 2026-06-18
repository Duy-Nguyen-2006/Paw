
# Design

## Domain Model

US-035 adds a small application-level helper over existing Paw state and session
transition primitives:

- Input: repository root, session id, and optional session lock options.
- Output: a discriminated result for selected slice, no pending slices, lock
  failure, foreign lock ownership, or invalid state transition.

The helper does not add a durable schema.

## Application Flow

The helper flow is:

1. Call `advancePawTaskSession` with transition `{ to: "SLICE_SELECT" }`.
2. Return `advanced` with the selected `current_slice_id` when the transition
   persists.
3. Map an invalid `SLICE_SELECT` transition from `PLAN_APPROVED` or
   `SLICE_DONE` with no pending slices to `no_pending_slices`.
4. Propagate missing-lock, stale-lock, foreign-lock, and other invalid
   transition results without rewriting state.

## Safety Boundaries

Lock status, owner checks, stale-lock detection, transition validation, and
atomic state writes remain owned by `advancePawTaskSession`.

The helper intentionally does not read state before proving current lock
ownership. This preserves the existing lock result precedence and prevents a
missing lock from being reported as a no-pending condition.

## Alternatives Considered

1. Read state first and return `no_pending_slices` before calling
   `advancePawTaskSession`.
   - Rejected because lock failures must propagate from the locked transition
     helper before state-derived no-op results.
2. Let callers call `advancePawTaskSession` directly.
   - Rejected because future callers would need to repeat result mapping and
     selected slice extraction.
3. Transition to `FINAL_REPORT` automatically when no pending slices remain.
   - Rejected because final-report assembly and terminal reporting are separate
     future runtime slices.
