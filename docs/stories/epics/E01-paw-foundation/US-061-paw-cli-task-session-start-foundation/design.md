
# Design

## Command Flow

`runPawStartCommand` parses bounded CLI args, then `createPawStartCommandResult`
delegates to `startPawTaskSession` for init, lock acquisition, and state
creation or resume.

## Lock Semantics

- `started` and `existing`: call `releasePawSessionLock` with the same lock
  options used for acquisition and report `lock released: yes/no`.
- `locked`: do not release a live foreign lock; report `lock released: no`.

## Output

Human-readable lines mirror other Paw bounded commands (`paw resume`, `paw
finalize`) and include:

- status (`started`, `existing`, `locked`)
- session id
- state name for started/existing
- init `created` / `existing` counts from `initializePawProject`
- reclaimed lock summary
- lock released flag

## Parser

- `paw start --help` / `-h` prints help and exits 0.
- Missing session id, session id starting with `-`, extra positional args, and
  unknown options set `process.exitCode = 1` without throwing.
