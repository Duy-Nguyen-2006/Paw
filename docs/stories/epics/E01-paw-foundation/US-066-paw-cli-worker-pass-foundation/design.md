
# Design

## Command Flow

`runPawCompleteWorkerCommand` parses bounded CLI args, then `createPawCompleteWorkerCommandResult`
checks `.paw` and session state, reads and parses `--output-file` with `parsePawSubAgentOutputJson`,
acquires the session lock, calls `completePawWorkerPass`, and releases an owned lock before
returning.

## Lock Semantics

- Parse worker output before acquiring lock when project/session exist; invalid or missing output
  files return without lock acquisition.
- Acquire lock before calling `completePawWorkerPass`, matching other bounded CLI commands.
- `locked` at acquire time: do not release a live foreign lock.
- Completed, invalid_state, no_selected_slice, invalid_worker_output, worker_not_passed,
  invalid_transition, not_locked, and locked_by_other after acquire: call `releasePawSessionLock`
  with the same lock options and report `lockReleased` on applicable outcomes.

## Parser

- Required positional `<session-id>` and `--output-file <path>`; optional `--timestamp <iso>`.
- Reject missing id, ids starting with `-`, missing option values, duplicate scalar options,
  invalid timestamp strings, unknown options, and extra positional args.

## Output

Human-readable lines include session id, status, selected slice id on success, state transition,
journal entry count, and lock release status.
