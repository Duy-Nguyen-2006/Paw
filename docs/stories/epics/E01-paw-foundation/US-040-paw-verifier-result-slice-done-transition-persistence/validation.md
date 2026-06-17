# Validation

## Proof Strategy

US-040 is complete when the core helper accepts explicit verification decisions
for the current slice and advances `VERIFYING -> SLICE_DONE` only under a live
current session lock.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | Result discrimination, empty-decision rejection, unverified-decision disclosure, and state transition result shaping. |
| Integration | Temp-project `.paw/` lock/state reads and writes, missing-lock no-write path, stale-lock no-write path, foreign-lock no-write path, wrong-state no-write path, null-current-slice no-write path, and persisted state assertions. |
| E2E | Not applicable; no full interactive Paw workflow is implemented. |
| Platform | Covered by temp-directory filesystem checks for `.paw/` session state and lock paths. |
| Performance | Not applicable; helper performs one bounded lock/status read, one state read, and one state write. |
| Logs/Audit | Not applicable; helper returns structured verification metadata for future runtime and final report callers. |

## Fixtures

- Temporary repositories under the OS temp directory.
- Deterministic session ids, lock owners, selected slice ids, pending slice ids,
  completed slice ids, and verification decisions.
- Existing session-state and lock helpers for persisted-state assertions.

## Commands

```text
cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-verifier-result.test.ts test/paw-reviewer-result.test.ts test/paw-resilience-policy.test.ts test/paw-state.test.ts test/paw-task-session.test.ts
scripts/bin/harness-cli story verify US-040
npm run check
```

## Acceptance Evidence

- Focused verifier-result and adjacent Paw tests passed:
  `cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-verifier-result.test.ts test/paw-reviewer-result.test.ts test/paw-resilience-policy.test.ts test/paw-state.test.ts test/paw-task-session.test.ts`.
- Harness story verification passed:
  `scripts/bin/harness-cli story verify US-040`.
- Root repository check passed: `npm run check`.
