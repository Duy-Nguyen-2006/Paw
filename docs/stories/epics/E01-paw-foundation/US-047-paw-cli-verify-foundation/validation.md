# Validation

## Proof Strategy

US-047 is complete when `paw verify <session-id>` safely records explicit
unverified decisions for configured gates and persists the current slice from
`VERIFYING` to `SLICE_DONE` under the session lock.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | Verify result formatting, missing project, missing session, live lock, invalid state, completed-with-unverified, and configured gate mapping. |
| Integration | Temp-project `.paw` initialization, persisted state reads/writes, lock acquire/release, live foreign lock preservation, command routing, and main routing before normal runtime. |
| E2E | Not applicable; no full interactive Paw workflow is implemented. |
| Platform | Covered by temp-directory filesystem checks for `.paw` session state and lock paths. |
| Performance | Not applicable; command performs bounded stat, lock, config read, state transition, and lock release operations. |
| Logs/Audit | No logs or artifacts are written; unverified gate reasons are returned in the command result. |

## Fixtures

- Temporary repositories under the OS temp directory.
- Source `paw-spec/config.yaml` copied into temp projects for `paw init`.
- Deterministic session ids, `VERIFYING` session state, wrong-state session, and
  live foreign locks.

## Commands

```text
cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-verify-command.test.ts
scripts/bin/harness-cli story verify US-047
npm run check
```

## Acceptance Evidence

- Focused verify-command test passed:
  `cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-verify-command.test.ts`.
- Harness story verification passed:
  `scripts/bin/harness-cli story verify US-047`.
- Root repository check passed: `npm run check`.
