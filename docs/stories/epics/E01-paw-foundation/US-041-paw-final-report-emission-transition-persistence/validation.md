
# Validation

## Proof Strategy

US-041 is complete when the core helper emits a final report markdown file for a
completed task and advances `SLICE_DONE -> FINAL_REPORT` only under a live
current session lock.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | Result discrimination, final report input error mapping, unverified-gate markdown disclosure, and transition result shaping. |
| Integration | Temp-project `.paw/` lock/state/summary reads and writes, missing-lock no-write path, stale-lock no-write path, foreign-lock no-write path, wrong-state no-write path, pending-slices no-write path, invalid-report-input no-write path, and persisted state/summary assertions. |
| E2E | Not applicable; no full interactive Paw workflow is implemented. |
| Platform | Covered by temp-directory filesystem checks for `.paw/` session state, lock, and summary paths. |
| Performance | Not applicable; helper performs one bounded lock/status read, one state read, one summary write, and one state write. |
| Logs/Audit | Final report markdown becomes durable task evidence at the session summary path. |

## Fixtures

- Temporary repositories under the OS temp directory.
- Deterministic session ids, lock owners, completed slice ids, evidence, and
  verification decisions.
- Existing session-state, lock, and final-report helpers for persisted-output
  assertions.

## Commands

```text
cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-final-report-emission.test.ts test/paw-final-report.test.ts test/paw-verifier-result.test.ts test/paw-state.test.ts test/paw-task-session.test.ts
scripts/bin/harness-cli story verify US-041
npm run check
```

## Acceptance Evidence

- Focused final-report-emission and adjacent Paw tests passed:
  `cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-final-report-emission.test.ts test/paw-final-report.test.ts test/paw-verifier-result.test.ts test/paw-state.test.ts test/paw-task-session.test.ts`.
- Harness story verification passed:
  `scripts/bin/harness-cli story verify US-041`.
- Root repository check passed: `npm run check`.
