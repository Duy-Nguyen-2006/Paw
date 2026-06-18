
# Exec Plan

## Goal

Implement locked Paw slice-selection persistence as a core helper without
adding CLI routing or orchestrator loop execution.

## Scope

In scope:

- Add `selectNextPawPlanSlice`.
- Add explicit input and result types.
- Persist `SLICE_SELECT` through `advancePawTaskSession`.
- Return the selected slice id on successful persistence.
- Return structured `no_pending_slices` without writing state.
- Propagate missing, stale, and foreign lock results.
- Propagate invalid transitions without writing state.
- Export only the new helper and types from the Paw barrel.
- Add focused Vitest coverage.
- Update story packet and test matrix evidence.

Out of scope:

- Editing CLI command files or `packages/coding-agent/src/main.ts`.
- Full Paw runtime orchestrator loop.
- Worker, reviewer, verifier, or provider execution.
- Final-report transition or report assembly.
- Lock acquisition, lock reclamation, or stale-lock removal inside this helper.

## Risk Classification

Risk flags:

- Existing behavior, because this composes existing Paw persistence, state,
  lock, and transition primitives.
- Weak proof, because Harness has no present impact-analysis provider in this
  session.

Hard gates:

- None. The helper is additive, does not expose a CLI route, and does not
  change existing persistence, state-machine, or lock behavior.

Lane: normal, bounded by additive helper scope and focused tests.

## Work Phases

1. Read required Paw persistence, state, session-store, plan approval,
   plan-slice, runtime docs, tests, and matrix files.
2. Record degraded impact context through Harness tool lookup.
3. Add focused slice-selection persistence tests.
4. Implement the core helper and barrel exports.
5. Update story packet and matrix evidence.
6. Run focused Vitest, root check, and Harness story verification.
7. Record durable story proof.

## Stop Conditions

Pause for human confirmation if:

- The implementation would need CLI command routing.
- The implementation would need to edit `packages/coding-agent/src/main.ts`.
- The implementation would need to change lower-level state-machine,
  session-store, or lock acquisition behavior.
- The implementation would need to run provider-backed worker, reviewer, or
  verifier behavior.
