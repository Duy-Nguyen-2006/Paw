# Validation

## Proof Strategy

US-042 is complete when the core helper persists blocked worker output for the
current slice and enters the matching `BLOCKED_*` state only under a live
current session lock.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | Result discrimination, blocked reason validation, blocked state mapping, non-blocked status rejection, and output metadata validation. |
| Integration | Temp-project `.paw/` lock/state reads and writes, missing-lock no-write path, stale-lock no-write path, foreign-lock no-write path, wrong-state no-write path, null-current-slice no-write path, invalid-blocked-reason no-write path, and persisted blocked-state assertions. |
| E2E | Not applicable; no full interactive Paw workflow is implemented. |
| Platform | Covered by temp-directory filesystem checks for `.paw/` session state and lock paths. |
| Performance | Not applicable; helper performs one bounded lock/status read, one state read, and one state write. |
| Logs/Audit | Blocked reason metadata becomes durable resume evidence in session state. |

## Fixtures

- Temporary repositories under the OS temp directory.
- Deterministic session ids, lock owners, selected slice ids, worker outputs,
  and blocked reasons.
- Existing session-state and lock helpers for persisted-state assertions.

## Commands

```text
cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-worker-blocked-result.test.ts test/paw-worker-result.test.ts test/paw-state.test.ts test/paw-task-session.test.ts
scripts/bin/harness-cli story verify US-042
npm run check
```

## Acceptance Evidence

- Focused worker-blocked-result and adjacent Paw tests passed:
  `cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-worker-blocked-result.test.ts test/paw-worker-result.test.ts test/paw-state.test.ts test/paw-task-session.test.ts`.
- Harness story verification passed:
  `scripts/bin/harness-cli story verify US-042`.
- Root repository check passed: `npm run check`.
