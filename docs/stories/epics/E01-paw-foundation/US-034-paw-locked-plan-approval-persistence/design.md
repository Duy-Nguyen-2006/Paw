
# Design

## Domain Model

US-034 adds a small application-level helper over existing Paw primitives:

- Input: repository root, session id, unknown planner slice input, and optional
  session lock options.
- Output: a discriminated result describing either invalid planner input or the
  exact `advancePawTaskSession` transition result.

The helper does not add a new durable schema.

## Application Flow

The helper flow is:

1. Call `createPawPlanSliceQueue` with the unknown planner slice input.
2. Return `invalid_plan` with validation issues when slice validation fails,
   without calling the transition persistence helper.
3. Call `advancePawTaskSession` with transition `{ to: "PLAN_APPROVED",
   slice_ids: queue.slice_ids }` when validation succeeds.
4. Return the ordered queue and the structured transition result.

## Safety Boundaries

The helper intentionally does not call `acquirePawSessionLock`, remove stale
lock files, or reclaim ownership. Lock ownership and transition persistence
remain owned by `advancePawTaskSession`.

Invalid planner data is normal control flow because it originates from a future
planner boundary. Malformed persisted state remains an exceptional store-read
failure owned by existing session readers.

## Alternatives Considered

1. Let callers validate planner slices and call `advancePawTaskSession`
   directly.
   - Rejected because each caller would need to repeat the same queue-ordering
     and `PLAN_APPROVED` transition construction.
2. Acquire or reclaim the lock inside plan approval.
   - Rejected because plan approval should prove current ownership through the
     existing transition helper, not silently create ownership.
3. Return only the transition result.
   - Rejected because future callers need to inspect the ordered planner queue
     that produced the persisted pending slice ids.
