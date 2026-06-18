
# Design

## Command Flow

`runPawCompleteVerificationCommand` parses bounded CLI args, then
`createPawCompleteVerificationCommandResult` checks `.paw` and session state, reads and validates
`--decision-file`, acquires the session lock, calls `completePawVerification`, and releases an owned
lock before returning.

## Lock Semantics

- Parse verify decisions before acquiring lock when project/session exist; invalid or missing decision
  files return without lock acquisition.
- Acquire lock before calling `completePawVerification`, matching other bounded CLI commands.
- `locked` at acquire time: do not release a live foreign lock.
- Completed, completed_with_unverified, invalid_state, no_selected_slice, invalid_verify_decisions,
  invalid_transition, not_locked, and locked_by_other after acquire: call `releasePawSessionLock`
  with the same lock options and report `lockReleased` on applicable outcomes.

## Parser

- Required positional `<session-id>` and `--decision-file <path>`.
- Reject missing id, ids starting with `-`, missing option values, duplicate scalar options,
  unknown options, and extra positional args.

## Decision File

- JSON array of `PawVerifyGateDecision` objects, or an object with `verify_decisions`.
- Require a non-empty array and minimal per-item fields: string `status`, `gate`, `gateSet`, booleans
  `verified` and `applicable`; unverified entries may include `reason`.

## Output

Human-readable lines include session id, status, selected slice id on success, state transition,
decision count, unverified count, and lock release status.
