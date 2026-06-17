# Validation

## Proof Strategy

US-046 is complete when `paw resume <session-id>` safely checks an existing
session's resume boundary under the session lock, releases that lock, and does
not claim full orchestrator execution.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | Resume result formatting, missing project, missing session, live lock, stale-lock reclaim, and ready-state variants. |
| Integration | Temp-project `.paw` initialization, persisted state reads, lock acquire/release, stale lock reclamation, live foreign lock preservation, command routing, and main routing before normal runtime. |
| E2E | Not applicable; no full interactive Paw workflow is implemented. |
| Platform | Covered by temp-directory filesystem checks for `.paw` session state and lock paths. |
| Performance | Not applicable; command performs bounded stat, lock, state read, and lock release operations. |
| Logs/Audit | No logs or artifacts are written. |

## Fixtures

- Temporary repositories under the OS temp directory.
- Source `paw-spec/config.yaml` copied into temp projects for `paw init`.
- Deterministic session ids, `REVIEWING` session state, live foreign locks, and
  stale lock heartbeat timestamps.

## Commands

```text
cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-resume-command.test.ts
scripts/bin/harness-cli story verify US-046
npm run check
```

## Acceptance Evidence

- Focused resume-command test passed:
  `cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-resume-command.test.ts`.
- Harness story verification passed:
  `scripts/bin/harness-cli story verify US-046`.
- Root repository check passed: `npm run check`.
