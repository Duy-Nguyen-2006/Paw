
# Exec Plan

## Goal

Implement worker-pass journal persistence and review transition persistence as a
core Paw helper without running sub-agents, applying edits, creating
checkpoints, or touching user git state.

## Scope

In scope:

- Add `completePawWorkerPass`.
- Add explicit input and result types.
- Check current live lock ownership before state reads.
- Require `IMPLEMENTING` with a selected slice.
- Validate accepted worker output metadata and journal-required changed-file
  fields.
- Return structured no-write results for lock, state, output, non-pass, and
  transition rejection paths.
- Append ordered slice-journal entries before writing `REVIEWING`.
- Preserve pending and completed slice queues.
- Export the helper and types from the Paw barrel.
- Add focused Vitest coverage.
- Update story packet and matrix evidence.

Out of scope:

- Editing CLI command files.
- Running worker, reviewer, or verifier execution.
- Creating checkpoints or shadow worktrees.
- Applying patches or computing content hashes.
- Git branch, index, stash, or working-tree mutation.
- Changing session-store, task-session, state-machine, slice-journal, or
  sub-agent contract behavior.

## Risk Classification

Risk flags:

- Existing behavior, because the helper composes existing Paw lock, state, and
  journal persistence primitives.
- Weak proof, because Harness reports no present impact-analysis provider in
  this session.

Hard gates:

- None. The helper is additive and does not change CLI behavior or lower-level
  persistence contracts.

Lane: normal, bounded by additive helper scope and focused tests.

## Work Phases

1. Read required Paw runtime, state, session, journal, sub-agent, barrel,
   adjacent tests, story, and matrix files.
2. Record degraded impact context through Harness tool lookup.
3. Add focused worker-result tests.
4. Implement the core helper and barrel exports.
5. Update story packet and matrix evidence.
6. Run focused Vitest, Harness story verification, and root `npm run check`.
7. Record durable story proof.

## Stop Conditions

Pause for human confirmation if:

- The implementation would need CLI routing.
- The implementation would need to alter session-store, task-session,
  state-machine, slice-journal, or sub-agent contracts.
- The implementation would need to run sub-agents, create checkpoints, apply
  patches, or touch git state.
