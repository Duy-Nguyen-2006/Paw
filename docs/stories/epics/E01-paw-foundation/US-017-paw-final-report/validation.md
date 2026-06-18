
# Validation

## Proof Strategy

This story is complete when focused tests prove terminal status selection,
evidence/risk preservation, degraded disclosure, unverified disclosure, and
markdown rendering. The root check must also pass.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | Report status, sorted/filtered fields, markdown sections. |
| Integration | Uses existing verify and degraded decision shapes. |
| E2E | Not applicable; no CLI report command yet. |
| Platform | Not applicable. |
| Performance | Not applicable for small pure helper. |
| Logs/Audit | Report model preserves exact evidence and reason strings. |

## Fixtures

- In-memory verification and degraded decisions.

## Commands

```text
cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-final-report.test.ts
npm run check
scripts/bin/harness-cli story verify US-017
```

## Acceptance Evidence

- `cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-final-report.test.ts` passed with 7 tests.
- Focused Paw suite through US-017 passed with 17 files and 152 tests.
- Root `npm run check` passed after Biome formatting, then passed again with no fixes applied.
- Harness story verification passed for US-017.
