# Validation

## Proof Strategy

This story is complete when focused tests prove valid output acceptance, first
invalid retry, retry-exhausted blocked fallback, fallback schema validity, and
metadata mismatch rejection. The root check must also pass.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | Accepted/retry/blocked decisions and metadata mismatch issues. |
| Integration | Blocked fallback validates through the existing sub-agent schema. |
| E2E | Not applicable; no provider execution yet. |
| Platform | Not applicable. |
| Performance | Not applicable for small policy helper. |
| Logs/Audit | Decisions preserve path-level validation issues. |

## Fixtures

- Raw JSON strings.

## Commands

```text
cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-subagent-response.test.ts
npm run check
scripts/bin/harness-cli story verify US-016
```

## Acceptance Evidence

- `cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-subagent-response.test.ts` passed with 6 tests.
- Focused Paw suite through US-016 passed with 16 files and 145 tests.
- Root `npm run check` passed after Biome formatting, then passed again with no fixes applied.
- Harness story verification passed for US-016.
