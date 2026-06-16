# Validation

## Proof Strategy

This story is complete when focused tests prove active-time exclusion, disabled
clock behavior, open segment closure, invalid segment handling, and config
integration. The root check must also pass.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | Active/paused/total ms, open segments, invalid timestamps. |
| Integration | Default runtime config pause state excludes human wait. |
| E2E | Not applicable; no orchestrator SLA enforcement yet. |
| Platform | Not applicable. |
| Performance | Not applicable for small pure helper. |
| Logs/Audit | Result preserves paused state names and durations. |

## Fixtures

- In-memory state timing segments.

## Commands

```text
cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-active-time.test.ts
npm run check
scripts/bin/harness-cli story verify US-018
```

## Acceptance Evidence

- `cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-active-time.test.ts` passed with 7 tests.
- Focused Paw suite through US-018 passed with 18 files and 159 tests.
- Root `npm run check` passed after Biome formatting, then passed again with no fixes applied.
- Harness story verification passed for US-018.
