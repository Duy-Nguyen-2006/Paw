
# Validation

## Proof Strategy

This story is complete when focused tests prove PASS and KILL outcomes for
failover, degraded reporting, resume completion, and data-loss conditions. The
root check must also pass.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | PASS drill and each threshold-specific KILL failure. |
| Integration | Evaluator composes with existing failover/degraded concepts. |
| E2E | Not applicable; no live provider chaos yet. |
| Platform | Injected drill events stand in for provider kill observations. |
| Performance | Not applicable for event evaluation. |
| Logs/Audit | Result records evidence and failure issues. |

## Fixtures

- In-memory drill event records.

## Commands

```text
cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-resilience-drill.test.ts
npm run check
scripts/bin/harness-cli story verify US-025
```

## Acceptance Evidence

- Focused US-025 test passed: 1 file, 7 tests.
- Focused Paw suite through US-025 passed: 25 files, 198 tests.
- Root `npm run check` passed after Biome formatted the new drill files, then
  passed again with no fixes applied.
- Harness story verification passed.
- S5 spike tracker is marked PASS with deterministic injected drill evaluator
  evidence in `paw-spec/docs/spikes/S5-resilience-drill.md`.
