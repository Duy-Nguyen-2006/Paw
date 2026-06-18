
# Overview

## Current Behavior

Paw can persist selected-slice implementation start and has an append-only
slice journal. Runtime callers do not yet have a core helper that accepts a
passing worker result, records the changed-file evidence for the selected
slice, and advances the session to review.

## Target Behavior

`completePawWorkerPass` accepts a repository root, session id, worker
`PawSubAgentOutput`, optional lock options, and an optional journal timestamp.

The helper verifies a live current session lock, reads the session state,
requires `IMPLEMENTING` with a selected slice, validates accepted worker output,
checks `IMPLEMENTING -> REVIEWING`, appends one slice-journal entry per changed
file, and then writes the next state.

Structured no-write results cover:

- Missing or stale locks.
- Foreign live locks.
- Wrong source state.
- Missing selected slice.
- Worker agent, session, slice, or changed-file journal metadata mismatch.
- Worker status other than `pass`.
- Invalid state transition.

Empty `changed_files` is allowed. In that case Paw still advances to
`REVIEWING` and creates no journal content.

## Affected Users

- Paw runtime implementers wiring the worker/reviewer boundary.
- Resume implementers relying on journal evidence to avoid redoing applied
  edits.
- Future CLI slice-loop implementers who need one core persistence primitive.

## Affected Product Docs

- `docs/product/paw-runtime.md`

## Non-Goals

- Running worker, reviewer, or verifier sub-agents.
- Creating checkpoints or shadow worktrees.
- Applying patches or computing content hashes.
- Touching the user's git branch, index, stash, or working tree.
- Editing CLI files.
