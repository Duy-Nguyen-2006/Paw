
# US-084: Paw Rollback Dry-Run Checkpoint Inspection

## Summary

Add a dry-run-only `paw rollback` command that inspects existing checkpoint metadata and reports what would be considered for rollback without changing files or git state.

## Scope

- Add `paw rollback <session-id> --dry-run [--checkpoint <name>]`.
- Read existing session state and checkpoint metadata.
- Select the latest checkpoint by name when `--checkpoint` is omitted.
- Print checkpoint scope, slice, base tree, changed files, and explicit no-mutation statements.
- Report missing project, missing session, no checkpoints, missing checkpoint, and invalid checkpoint metadata safely.
- Route through `handlePawCommand` and `main` before normal agent runtime.
- Do not acquire locks, write state, call git, restore files, delete files, or execute rollback.

## Acceptance Criteria

- Tests prove explicit checkpoint dry-run reports metadata and does not create a lock.
- Tests prove latest checkpoint selection by checkpoint name.
- Tests prove missing and invalid metadata cases return structured results without mutation.
- Tests prove non-dry-run rollback is rejected.
- Tests prove CLI routing and help work without invoking normal agent runtime.
