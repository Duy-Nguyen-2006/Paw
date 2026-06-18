
# Validation

## Proof Strategy

This story is complete when focused tests prove session count retention,
artifact age retention, preservation of fresh records, invalid input handling,
and default config integration. The root check must also pass.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | Keep/delete sessions and artifacts, invalid timestamps/config. |
| Integration | Default runtime config drives keep count and artifact days. |
| E2E | Not applicable; no `paw clean` CLI command yet. |
| Platform | Not applicable; no filesystem deletion yet. |
| Performance | Not applicable for small record arrays. |
| Logs/Audit | Plan preserves exact ids, names, paths, and reasons. |

## Fixtures

- In-memory retention records.

## Commands

```text
cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-retention-policy.test.ts
npm run check
scripts/bin/harness-cli story verify US-020
```

## Acceptance Evidence

- Focused US-020 test passed: 1 file, 7 tests.
- Focused Paw suite through US-020 passed: 20 files, 173 tests.
- Root `npm run check` passed after fixing the retention policy type
  narrowing.
- Harness story verification passed.
