# Design

## Dry-Run Only Command

`paw rollback` is implemented only as metadata inspection. The parser requires `--dry-run`; all non-dry-run invocations fail with a safe error.

## Metadata Inspection

The command reads `.paw/sessions/<session-id>/state.json` and `.paw/checkpoints/<session-id>/<checkpoint>/checkpoint.json`. If no checkpoint is specified, it chooses the lexicographically latest checkpoint directory name, matching timestamp-prefixed checkpoint names.

## No Mutation Boundary

The command does not acquire locks, write state, write reports, touch checkpoint files, call git, or restore contents. Output includes explicit no-mutation lines: no files changed, no rollback executed, and git state not touched.

## Out Of Scope

- Real rollback execution.
- Shadow worktree creation.
- Git reset, clean, stash, checkout, restore, or branch/index mutation.
- File content restoration or deletion.
- Migration, dependency, generated artifact, or external side-effect rollback.
