
# Validation

## Proof Strategy

This story is complete when focused tests prove artifact name generation,
path/ref resolution, report writes/reads, and invalid ref rejection. The root
check must also pass.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | Slug/name/ref validation. |
| Integration | Temporary `.paw/artifacts` report write/read. |
| E2E | Not applicable; no sub-agent execution yet. |
| Platform | Filesystem persistence in temp directories. |
| Performance | Not applicable for small report helpers. |
| Logs/Audit | Invalid ref errors include offending value. |

## Fixtures

- Temporary directory.

## Commands

```text
cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-artifacts.test.ts
npm run check
scripts/bin/harness-cli story verify US-014
```

## Acceptance Evidence

- `cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-artifacts.test.ts` passed with 6 tests.
- Focused Paw suite through US-014 passed with 14 files and 131 tests.
- Root `npm run check` passed with no fixes applied.
- Harness story verification passed for US-014.
