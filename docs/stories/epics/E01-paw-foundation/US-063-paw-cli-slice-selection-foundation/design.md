# Design

## Command Flow

`runPawSelectSliceCommand` parses bounded CLI args, then
`createPawSelectSliceCommandResult` checks `.paw` and session state, acquires the
session lock, calls `selectNextPawPlanSlice`, and releases an owned lock before
returning.

## Lock Semantics

- Acquire lock before calling `selectNextPawPlanSlice`, matching other bounded CLI
  commands such as `paw approve-plan`, `paw resume`, and `paw finalize`.
- `locked` at acquire time: do not release a live foreign lock.
- Advanced, no_pending_slices, invalid_transition, not_locked, and locked_by_other
  after acquire: call `releasePawSessionLock` with the same lock options and report
  `lock released`.

## Output

Human-readable lines mirror other Paw bounded commands and include session id,
selected slice id on success, state transition or source state, issue summaries on
invalid cases, and lock release status where applicable.

## Parser

- `paw select-slice --help` / `-h` prints help and exits 0.
- Missing session id, session id starting with `-`, extra positional args, and
  unknown options set `process.exitCode = 1` without throwing.
