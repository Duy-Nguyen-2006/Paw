# Validation

## Proof Strategy

This story is complete when focused tests prove PASS and KILL outcomes for cost,
token, and active-time thresholds, plus advisory cache behavior for hosted and
local providers. The root check must also pass.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | PASS metrics, USD KILL, token KILL, active-time KILL. |
| Integration | Hosted cache warning is advisory; local cache is N/A. |
| E2E | Not applicable; no live provider task yet. |
| Platform | Injected active-time metrics stand in for live high-risk task timing. |
| Performance | Evaluator covers high-risk SLA and budget limits. |
| Logs/Audit | Result records evidence, issues, and cache advisory status. |

## Fixtures

- In-memory high-risk task metric records.

## Commands

```text
cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-cost-latency-cache.test.ts
npm run check
scripts/bin/harness-cli story verify US-026
```

## Acceptance Evidence

- Focused US-026 test passed: 1 file, 7 tests.
- Focused Paw suite through US-026 passed: 26 files, 205 tests.
- Root `npm run check` passed after Biome formatted the new evaluator files,
  then passed again with no fixes applied.
- Harness story verification passed.
- S2 spike tracker is marked PASS with deterministic injected metrics evaluator
  evidence in `paw-spec/docs/spikes/S2-cost-latency-cache.md`.
