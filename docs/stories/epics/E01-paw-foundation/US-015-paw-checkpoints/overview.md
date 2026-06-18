
# US-015: Paw Checkpoint Metadata Persistence

## User Story

As Paw's future rollback runtime, I need deterministic checkpoint metadata
helpers so each slice can record what checkpoint belongs to a session without
touching the user's git state.

## Source References

- `SPEC.md` §13 Checkpoint & rollback.
- `SPEC.md` §9.5 Read-snapshot vs dirty working tree.
- `SPEC.md` §21 P2/P3 foundation and core slice.

## Scope

Implement checkpoint name/path helpers and metadata write/read helpers under
`.paw/checkpoints/<session>/<checkpoint>/`.

## Non-Goals

- No shadow worktree creation.
- No rollback execution.
- No git ref, stash, reset, or index mutation.
- No migration or retention cleanup.

## Acceptance Criteria

- Checkpoint names include UTC timestamp, slice id, and short id.
- Names reject traversal, slashes, and empty unsafe values.
- Paths resolve under `.paw/checkpoints/<session>/<checkpoint>/`.
- Metadata writes create parent directories atomically and preserve JSON.
- Metadata records include session id, optional slice id, created timestamp,
  scope, base tree marker, and changed files.
- Invalid metadata returns path-level validation issues instead of crashing.
