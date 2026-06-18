
# Design

## Command Flow

`runPawApprovePlanCommand` parses bounded CLI args, then
`createPawApprovePlanCommandResult` checks `.paw` and session state, acquires the
session lock, builds planner slices from `--slice` values, calls
`approvePawPlanSlices`, and releases an owned lock before returning.

## Slice Parsing

Each `--slice` value maps to one planner slice with `order` equal to its positional
index among slice flags. Values without `:` use the full value as `slice_id` and
`title`. Values with `:` split on the first colon only.

## Lock Semantics

- Acquire lock before calling `approvePawPlanSlices`, matching other bounded CLI
  commands such as `paw verify` and `paw finalize`.
- `locked` at acquire time: do not release a live foreign lock.
- Advanced, invalid_plan, invalid_transition, not_locked, and locked_by_other after
  acquire: call `releasePawSessionLock` with the same lock options and report
  `lock released`.

## Output

Human-readable lines mirror other Paw bounded commands and include session id, queue
slice ids for parsed plans, state transition on success, issue summaries on invalid
cases, and lock release status where applicable.

## Parser

- `paw approve-plan --help` / `-h` prints help and exits 0.
- Missing session id, session id starting with `-`, missing `--slice`, blank slice
  value, missing slice value, extra positional args, and unknown options set
  `process.exitCode = 1` without throwing.
