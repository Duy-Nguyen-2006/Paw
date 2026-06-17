# Validation

## Proof Strategy

US-084 is complete when `paw rollback` can inspect checkpoint metadata in dry-run mode and prove it does not mutate files, locks, state, or git.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | Parser accepts dry-run forms and rejects non-dry-run, duplicates, missing values, and unknown options. |
| Integration | Command reads checkpoint metadata, selects latest checkpoint, and reports missing/invalid cases. |
| E2E | Not applicable; no browser or external runtime flow. |
| Platform | Temporary Paw projects prove no lock file/state mutation and no rollback execution. |
| Performance | One session read and one checkpoint metadata read per explicit checkpoint dry-run. |
| Logs/Audit | Output states no files changed, no rollback executed, and git state not touched. |

## Fixtures

- Temporary Paw project with initialized `.paw`.
- Session state JSON.
- Valid and invalid checkpoint metadata JSON.

## Commands

```text
cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-rollback-command.test.ts
scripts/bin/harness-cli story verify US-084
npm run check
```

## Acceptance Evidence

- Focused Paw rollback command tests pass.
- Harness story verification passes.
- Root repository check passes.
