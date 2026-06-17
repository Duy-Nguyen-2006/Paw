# Validation

## Proof Strategy

US-064 is complete when `paw prepare-checkpoint <session-id> ...` acquires the
session lock, prepares slice checkpoint metadata through `preparePawSliceCheckpoint`,
releases owned locks for applicable outcomes, preserves live foreign locks for
acquire-time `locked`, and routes through `handlePawCommand` / `main` before normal
agent runtime.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | Parser validation, changed-file null hash parsing, and result formatting. |
| Integration | Temp-project SLICE_SELECT preparation, invalid state/no selected slice, missing project/session, and live foreign lock preservation. |
| E2E | `main(["paw","prepare-checkpoint",...])` routes before agent runtime without setting exit code. |
| Platform | Temp-directory filesystem checks for `.paw/`, locks, and checkpoint metadata persistence. |
| Performance | Not applicable; bounded file operations only. |
| Logs/Audit | Not applicable; structured stdout for operators. |

## Fixtures

- Runtime config copied from repository `paw-spec/config.yaml` into temporary test projects.
- Temporary `.paw/sessions/<id>/state.json` and `session.lock` files.
- Deterministic lock timestamps and TTL values.

## Commands

```text
cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-slice-checkpoint-command.test.ts test/paw-slice-checkpoint.test.ts test/paw-slice-selection-command.test.ts test/paw-init-command.test.ts
npm run check
scripts/bin/harness-cli story verify US-064
```

## Acceptance Evidence

- Focused prepare-checkpoint and related Paw session tests pass.
- Root repository check passes: `npm run check`.
- Harness story verification passes when US-064 is registered in Harness.
