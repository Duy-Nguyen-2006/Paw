# US-061: Paw CLI Task Session Start Foundation

## Summary

Add `paw start <session-id>` as a bounded CLI foundation that initializes `.paw`
when needed, calls `startPawTaskSession`, and releases an acquired session lock
before returning for `started` and `existing` outcomes.

## Scope

- Add `start-command.ts` with `createPawStartCommandResult`, formatting, and
  `runPawStartCommand`.
- Route `paw start` through `handlePawCommand` before the normal agent runtime.
- Report structured `started`, `existing`, and `locked` outcomes with init counts,
  state name, reclaimed lock metadata, and lock-release status.
- Export start helpers from `packages/coding-agent/src/paw/index.ts`.
- Add focused tests and Harness story documentation.

## Acceptance Criteria

- Fresh start creates `.paw`, writes `INTAKE` session state, and releases the
  acquired lock.
- Existing valid session state is reported without overwrite.
- Live foreign locks are reported and not released.
- Stale locks are reclaimed through the existing lock helper.
- Help, missing session id, session ids beginning with `-`, extra args, and
  unknown options set `exitCode = 1` without throwing.
- Focused tests listed in validation pass.
