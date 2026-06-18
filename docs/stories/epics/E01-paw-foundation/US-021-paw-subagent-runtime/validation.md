
# Validation

## Proof Strategy

This story is complete when focused tests prove accepted executor output,
invalid output retry, exhausted retry blocking, and handoff overflow blocking.
The root check must also pass.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | Accepted raw JSON, retry on invalid JSON, blocked after retry, oversized handoff. |
| Integration | Runtime uses existing sub-agent response evaluator contract. |
| E2E | Not applicable; no CLI command wiring yet. |
| Platform | Not applicable; no child process or sandbox execution yet. |
| Performance | Not applicable for in-memory runtime boundary. |
| Logs/Audit | Result preserves attempts, issues, and blocked reason data. |

## Fixtures

- In-memory executor function.

## Commands

```text
cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-subagent-runtime.test.ts
npm run check
scripts/bin/harness-cli story verify US-021
```

## Acceptance Evidence

- Focused US-021 test passed: 1 file, 4 tests.
- Focused Paw suite through US-021 passed: 21 files, 177 tests.
- Root `npm run check` passed after Biome formatted the new runtime files,
  then passed again with no fixes applied.
- Harness story verification passed.
