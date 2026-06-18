
# Exec Plan

## Goal

Implement locked selected-slice implementation-start persistence as a core Paw
helper without running workers, creating checkpoints, appending journals, or
touching user git state.

## Scope

In scope:

- Add `beginPawSliceImplementation`.
- Add explicit input and result types.
- Delegate the `IMPLEMENTING` transition to `advancePawTaskSession`.
- Return selected slice id on success.
- Return structured no-write results for missing, stale, foreign-lock,
  missing-selected-slice, and invalid source-state cases.
- Export the helper and types from the Paw barrel.
- Add focused Vitest coverage.
- Update story packet and matrix evidence.

Out of scope:

- Editing CLI command files.
- Running worker execution.
- Creating checkpoints or shadow worktrees.
- Appending slice journal entries.
- Git branch, index, stash, or working-tree mutation.
- Changing session-store, task-session, or state-machine behavior.

## Risk Classification

Risk flags:

- Existing behavior, because the helper composes existing Paw lock and session
  transition persistence primitives.
- Weak proof, because Harness reports no present impact-analysis provider in
  this session.

Hard gates:

- None. The helper is additive and does not change CLI behavior or lower-level
  persistence contracts.

Lane: normal, bounded by additive helper scope and focused tests.

## Work Phases

1. Read required Paw runtime, session, state, slice-selection, slice-checkpoint,
   barrel, adjacent tests, story, and matrix files.
2. Record degraded impact context through Harness tool lookup.
3. Add focused slice-implementation tests.
4. Implement the core helper and barrel exports.
5. Update story packet and matrix evidence.
6. Run focused Vitest, Harness story verification, and root `npm run check`.
7. Record durable story proof.

## Stop Conditions

Pause for human confirmation if:

- The implementation would need CLI routing.
- The implementation would need to alter session-store, task-session, or
  state-machine behavior.
- The implementation would need to run workers, create checkpoints, append
  journals, or touch git state.
