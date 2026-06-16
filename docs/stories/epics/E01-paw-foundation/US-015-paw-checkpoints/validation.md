# Validation

## Proof Strategy

This story is complete when focused tests prove checkpoint name generation,
path resolution, metadata validation, atomic write/read, and invalid input
rejection. The root check must also pass.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | Name/path/metadata validation. |
| Integration | Temporary `.paw/checkpoints` metadata write/read. |
| E2E | Not applicable; no rollback execution yet. |
| Platform | Filesystem persistence in temp directories. |
| Performance | Not applicable for small metadata helpers. |
| Logs/Audit | Invalid values include path-level validation issues. |

## Fixtures

- Temporary directory.

## Commands

```text
cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-checkpoints.test.ts
npm run check
scripts/bin/harness-cli story verify US-015
```

## Acceptance Evidence

- `cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-checkpoints.test.ts` passed with 8 tests.
- Focused Paw suite through US-015 passed with 15 files and 139 tests.
- Root `npm run check` passed after Biome formatting, then passed again with no fixes applied.
- Harness story verification passed for US-015.
