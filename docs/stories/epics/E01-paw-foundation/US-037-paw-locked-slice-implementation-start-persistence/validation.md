# Validation

## Proof Strategy

US-037 is complete when the core helper persists `SLICE_SELECT -> IMPLEMENTING`
only under a live current session lock, preserves slice queues, returns the
selected slice id on success, and returns stable no-write results for lock and
transition rejection paths.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | Result discrimination, selected-slice extraction, missing-selected-slice mapping, and invalid-transition propagation. |
| Integration | Temp-project `.paw/` session lock/state reads and writes, missing-lock no-write path, stale-lock no-write path, foreign-lock no-write path, null-current-slice no-write path, and invalid-source-state no-write path. |
| E2E | Not applicable; no full interactive Paw workflow is implemented. |
| Platform | Covered by temp-directory filesystem checks for `.paw/` session state paths. |
| Performance | Not applicable; helper performs one bounded task-session transition. |
| Logs/Audit | Not applicable; helper returns structured state for future runtime and CLI callers. |

## Fixtures

- Temporary repositories under the OS temp directory.
- Deterministic session ids, lock owners, timestamps, selected slice ids,
  pending slice ids, and completed slice ids.
- Existing session-state read/write helpers for persisted-state assertions.

## Commands

```text
cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-slice-implementation.test.ts test/paw-slice-selection.test.ts test/paw-task-session.test.ts test/paw-state.test.ts
scripts/bin/harness-cli story verify US-037
npm run check
```

## Acceptance Evidence

- Focused slice-implementation and adjacent Paw tests passed:
  `cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-slice-implementation.test.ts test/paw-slice-selection.test.ts test/paw-task-session.test.ts test/paw-state.test.ts`
  with 25 tests passing.
- Harness story verification passed:
  `scripts/bin/harness-cli story verify US-037`.
- Root repository check passed: `npm run check`.
