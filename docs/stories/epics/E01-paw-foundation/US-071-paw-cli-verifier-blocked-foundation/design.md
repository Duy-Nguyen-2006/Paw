# Design

## Command Flow

`runPawBlockReviewerCommand` parses bounded CLI args, then `createPawBlockReviewerCommandResult` checks
`.paw` and session state, reads and validates `--decision-file` via `parsePawSubAgentOutputJson`,
acquires the session lock, calls `blockPawVerifierResult`, and releases an owned lock before returning.

## Lock Semantics

- Parse verify decision before acquiring lock when project/session exist; invalid or missing output
  files return without lock acquisition.
- Acquire lock before calling `blockPawVerifierResult`, matching other bounded CLI commands.
- `locked` at acquire time: do not release a live foreign lock.
- Blocked, invalid_state, no_selected_slice, invalid_blocked_decisions, invalid_blocked_decisions,
  invalid_blocked_reason, invalid_transition, not_locked, and locked_by_other after acquire: call
  `releasePawSessionLock` with the same lock options and report `lockReleased` on applicable outcomes.

## Parser

- Required positional `<session-id>` and `--decision-file <path>`.
- Reject missing id, ids starting with `-`, missing option values, duplicate scalar options,
  unknown options, and extra positional args.

## Output

Human-readable lines include session id, status, selected slice id on success, state transition,
blocked reason code and message when available, and lock release status.
