
# Design

## Domain Model

US-037 adds a small application-level helper over existing Paw primitives:

- `advancePawTaskSession` owns lock liveness, lock ownership, transition
  validation, and atomic state persistence.
- `transitionPawSessionState` already permits `SLICE_SELECT -> IMPLEMENTING`
  only when `current_slice_id` is present.

The helper does not add durable schema fields. It returns a caller-friendly
`selectedSliceId` derived from the persisted `nextState.current_slice_id`.

## Application Flow

The helper flow is:

1. Call `advancePawTaskSession` with `{ to: "IMPLEMENTING" }`.
2. Return `not_locked` for missing or stale locks.
3. Return `locked_by_other` for foreign live locks.
4. Return `no_selected_slice` when the invalid transition came from
   `SLICE_SELECT` with a null `current_slice_id`.
5. Return `invalid_transition` for other invalid source states.
6. For an advanced result, read `nextState.current_slice_id`.
7. Throw only if the impossible invariant occurs: the transition advanced but
   no selected slice id exists.
8. Return `advanced` with the selected slice id and task-session advance result.

## Safety Boundaries

The helper does not acquire, reclaim, refresh, or release locks directly. It
does not read or write session state directly. It also does not inspect or
mutate git state, create checkpoints, append journal entries, or run workers.

## Alternatives Considered

1. Reimplement lock and state checks in the helper.
   - Rejected because task-session already centralizes current-lock ownership
     and atomic write semantics.
2. Return only the task-session advance result.
   - Rejected because worker-loop callers need the selected slice id without
     re-inspecting state.
3. Combine checkpoint preparation and implementation start.
   - Rejected because checkpoint metadata and worker start persistence are
     separate orchestration boundaries.
