
# Exec Plan

## Goal

Implement locked Paw plan approval persistence as a core helper without adding
CLI routing, planner provider execution, or orchestrator loop execution.

## Scope

In scope:

- Add `approvePawPlanSlices`.
- Add explicit input and result types.
- Validate unknown planner slice input through `createPawPlanSliceQueue`.
- Return structured `invalid_plan` outcomes before state write attempts.
- Delegate valid plans to `advancePawTaskSession` with ordered slice ids.
- Surface the ordered queue alongside transition results.
- Export only the new helper and types from the Paw barrel.
- Add focused Vitest coverage.
- Update story packet and test matrix evidence.

Out of scope:

- Editing CLI command files or `packages/coding-agent/src/main.ts`.
- Full Paw CLI plan approval command completion.
- Full Paw runtime orchestrator loop.
- Provider-backed planner execution.
- Lock acquisition, lock reclamation, or stale-lock removal inside this helper.

## Risk Classification

Risk flags:

- Existing behavior, because this composes existing Paw persistence, state,
  lock, and planner queue primitives.
- Weak proof, because Harness has no present impact-analysis provider and
  GitNexus cannot see the untracked Paw symbols in this worktree.

Hard gates:

- None. The helper is additive, does not expose a CLI route, and does not
  change existing persistence, state-machine, queue-validation, or lock
  behavior.

Lane: normal, bounded by additive helper scope and focused tests.

## Work Phases

1. Read required Paw persistence, state, session-store, plan-slice, tests,
   runtime docs, and matrix files.
2. Record degraded impact context through Harness tool lookup.
3. Add focused plan approval persistence tests.
4. Implement the core helper and barrel exports.
5. Update story packet and matrix evidence.
6. Run focused Vitest, root check, and Harness story verification.
7. Record durable story proof.

## Stop Conditions

Pause for human confirmation if:

- The implementation would need CLI command routing.
- The implementation would need to edit `packages/coding-agent/src/main.ts`.
- The implementation would need to acquire, reclaim, or remove locks inside the
  approval helper.
- The implementation would need to run provider-backed planner or worker
  behavior.
