# Design

## Command Flow

`runPawPrepareCheckpointCommand` parses bounded CLI args, then
`createPawPrepareCheckpointCommandResult` checks `.paw` and session state, acquires
the session lock, calls `preparePawSliceCheckpoint`, and releases an owned lock
before returning.

## Lock Semantics

- Acquire lock before calling `preparePawSliceCheckpoint`, matching other bounded
  CLI commands such as `paw select-slice` and `paw approve-plan`.
- `locked` at acquire time: do not release a live foreign lock.
- Prepared, invalid_state, no_selected_slice, not_locked, and locked_by_other after
  acquire: call `releasePawSessionLock` with the same lock options and report lock
  release on prepared outcomes.

## Parser

- Required: `--base-tree`, `--short-id`, `--timestamp`, and at least one
  `--changed-file`.
- Repeatable `--changed-file <path>=<hash|null>` preserves order; only the literal
  RHS `null` maps to `content_hash: null`.
- Reject duplicate scalar options, blank values, missing `=`, invalid timestamps, and
  unknown/extra args.

## Output

Human-readable lines include session id, checkpoint name, selected slice id,
metadata path relative to repo root, state name, changed-file count, and lock
release status.
