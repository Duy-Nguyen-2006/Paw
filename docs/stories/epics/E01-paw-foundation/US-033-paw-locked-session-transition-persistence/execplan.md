# Exec Plan

## Goal

Implement locked Paw session transition persistence as a core helper without
adding CLI routing or orchestrator execution.

## Scope

In scope:

- Add `advancePawTaskSession`.
- Add explicit input and result types.
- Require an existing live lock owned by the current caller.
- Return structured `not_locked`, `locked_by_other`, and `invalid_transition`
  outcomes without writing state.
- Apply `transitionPawSessionState` and persist the next state atomically only
  when ownership and transition validation both pass.
- Export only the new helper and types from the Paw barrel.
- Add focused Vitest coverage.
- Update story packet and test matrix evidence.

Out of scope:

- Editing CLI command files or `packages/coding-agent/src/main.ts`.
- Full Paw CLI spec/build/resume completion.
- Full Paw runtime orchestrator loop.
- Provider-backed execution.
- User-facing resume command UX.

## Risk Classification

Risk flags:

- Existing behavior, because this composes existing Paw persistence, state, and
  lock primitives.
- Weak proof, because Harness has no present impact-analysis provider and
  GitNexus cannot see the untracked Paw task-session symbols in this worktree.

Hard gates:

- None. The helper is additive, does not expose a CLI route, and does not
  change existing persistence or lock behavior.

Lane: normal, bounded by additive helper scope and focused tests.

## Work Phases

1. Read required Paw persistence, state, session-store, tests, runtime docs, and
   matrix files.
2. Record degraded impact context through Harness tool lookup.
3. Add focused transition persistence tests.
4. Implement the core helper and barrel exports.
5. Update story packet and matrix evidence.
6. Run focused Vitest, root check, and Harness story verification.
7. Record durable story proof.

## Stop Conditions

Pause for human confirmation if:

- The implementation would need CLI command routing.
- The implementation would need to edit `packages/coding-agent/src/main.ts`.
- The implementation would need to acquire, reclaim, or remove locks inside the
  transition helper.
- The implementation would need to run provider-backed Paw runtime behavior.
