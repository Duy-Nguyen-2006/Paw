# Validation

## Proof Strategy

This story is complete when focused tests prove idempotent `.paw`
initialization, gitignore contents, no overwrite of existing durable files, and
atomic JSON state writes. The root check must also pass.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | Path resolution and gitignore rendering. |
| Integration | Temporary-directory init creates expected files, second init is no-op for existing durable files, atomic JSON write/read round-trips. |
| E2E | Not applicable; no CLI command yet. |
| Platform | Local filesystem behavior only. |
| Performance | Not applicable for small init files. |
| Logs/Audit | Init result lists created and existing paths. |

## Fixtures

- Temporary directories.
- `paw-spec/config.yaml` loaded through the existing config loader.

## Commands

```text
cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-persistence.test.ts
npm run check
scripts/bin/harness-cli story verify US-003
```

## Acceptance Evidence

- `cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-persistence.test.ts test/paw-state.test.ts test/paw-contracts.test.ts`
  passed: 15 tests in 3 files.
- `npm run check` passed from the repository root with no fixes applied on the
  final run.
- `scripts/bin/harness-cli story verify US-003` passed.
