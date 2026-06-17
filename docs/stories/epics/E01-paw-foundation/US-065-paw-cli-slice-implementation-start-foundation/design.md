# Design

## Command Flow

`runPawBeginImplementationCommand` parses bounded CLI args, then
`createPawBeginImplementationCommandResult` checks `.paw` and session state, acquires
the session lock, calls `beginPawSliceImplementation`, and releases an owned lock
before returning.

## Lock Semantics

- Acquire lock before calling `beginPawSliceImplementation`, matching other bounded
  CLI commands such as `paw select-slice` and `paw prepare-checkpoint`.
- `locked` at acquire time: do not release a live foreign lock.
- Advanced, no_selected_slice, invalid_transition, not_locked, and locked_by_other after
  acquire: call `releasePawSessionLock` with the same lock options and report
  `lockReleased` on applicable outcomes.

## Parser

- Required positional `<session-id>` only; reject missing id, ids starting with `-`,
  unknown options, and extra positional args.

## Output

Human-readable lines include session id, selected slice id on success, state
transition, and lock release status.
