
# Validation

## Proof Strategy

US-038 is complete when the core helper persists accepted worker-pass
changed-file evidence for the current slice and advances `IMPLEMENTING ->
REVIEWING` only under a live current session lock.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | Result discrimination, worker output metadata validation, non-pass status rejection, changed-file journal field validation, and journal entry construction. |
| Integration | Temp-project `.paw/` lock/state/journal reads and writes, missing-lock no-write path, stale-lock no-write path, foreign-lock no-write path, wrong-state no-write path, null-current-slice no-write path, empty-changed-files advance path, and persisted state/journal assertions. |
| E2E | Not applicable; no full interactive Paw workflow is implemented. |
| Platform | Covered by temp-directory filesystem checks for `.paw/` session state and journal paths. |
| Performance | Not applicable; helper performs one bounded lock/status read, one state read, ordered journal appends, and one state write. |
| Logs/Audit | Not applicable; helper returns structured state for future runtime and CLI callers. |

## Fixtures

- Temporary repositories under the OS temp directory.
- Deterministic session ids, lock owners, timestamps, selected slice ids,
  pending slice ids, completed slice ids, and worker outputs.
- Existing session-state, lock, and slice-journal read/write helpers for
  persisted-state assertions.

## Commands

```text
cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-worker-result.test.ts test/paw-slice-journal.test.ts test/paw-subagent-response.test.ts test/paw-slice-implementation.test.ts test/paw-task-session.test.ts
scripts/bin/harness-cli story verify US-038
npm run check
```

## Acceptance Evidence

- Focused worker-result and adjacent Paw tests passed:
  `cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-worker-result.test.ts test/paw-slice-journal.test.ts test/paw-subagent-response.test.ts test/paw-slice-implementation.test.ts test/paw-task-session.test.ts`
  with 33 tests passing.
- Harness story verification passed:
  `scripts/bin/harness-cli story verify US-038`.
- Root repository check passed: `npm run check`.
