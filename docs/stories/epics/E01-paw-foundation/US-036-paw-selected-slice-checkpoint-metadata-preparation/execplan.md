
# Exec Plan

## Goal

Implement selected-slice checkpoint metadata preparation as a core Paw helper
without creating snapshots, touching git state, or adding CLI routing.

## Scope

In scope:

- Add `preparePawSliceCheckpoint`.
- Add explicit input and result types.
- Verify a live current session lock before reading state.
- Require `SLICE_SELECT` with a non-null `current_slice_id`.
- Write slice checkpoint metadata through the existing checkpoint writer.
- Return structured no-write results for missing, stale, foreign-lock, wrong
  state, and missing selected-slice cases.
- Export the helper and types from the Paw barrel.
- Add focused Vitest coverage.
- Update story packet and matrix evidence.

Out of scope:

- Editing CLI command files.
- Creating shadow worktrees.
- Git branch, index, stash, or working-tree mutation.
- Changing session-store, task-session, state-machine, or checkpoint writer
  behavior.
- Full Paw orchestrator loop execution.

## Risk Classification

Risk flags:

- Existing behavior, because the helper composes existing Paw lock, state, and
  checkpoint persistence primitives.
- Weak proof, because Harness reports no present impact-analysis provider in
  this session.

Hard gates:

- None. The helper is additive and does not change CLI behavior or lower-level
  persistence contracts.

Lane: normal, bounded by additive helper scope and focused tests.

## Work Phases

1. Read required Paw runtime, checkpoint, session-store, state, slice-selection,
   barrel, adjacent tests, story, and matrix files.
2. Record degraded impact context through Harness tool lookup.
3. Add focused slice-checkpoint tests.
4. Implement the core helper and barrel exports.
5. Update story packet and matrix evidence.
6. Run focused Vitest, Harness story verification, and root `npm run check`.
7. Record durable story proof.

## Stop Conditions

Pause for human confirmation if:

- The implementation would need CLI routing.
- The implementation would need to alter session-store, task-session,
  state-machine, or checkpoint writer behavior.
- The implementation would need to create snapshots or touch git state.
