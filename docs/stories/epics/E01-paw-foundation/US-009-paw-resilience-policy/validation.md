# Validation

## Proof Strategy

This story is complete when focused tests prove retry/failover decisions,
blocked timeout decisions, degraded failover markers, loop-cap decisions, and
unverified gate records. The root check must also pass.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | LLM outcome decisions, timeout decisions, loop-cap decisions, gate availability. |
| Integration | Default runtime config drives retry and loop thresholds. |
| E2E | Not applicable; no CLI command yet. |
| Platform | Not applicable; no process execution yet. |
| Performance | Not applicable for pure helpers. |
| Logs/Audit | Blocked and unverified outputs include reportable reasons. |

## Fixtures

- `paw-spec/config.yaml`

## Commands

```text
cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-resilience-policy.test.ts
npm run check
scripts/bin/harness-cli story verify US-009
```

## Acceptance Evidence

Implemented in `packages/coding-agent/src/paw/resilience-policy.ts` with
coverage in `packages/coding-agent/test/paw-resilience-policy.test.ts`.

- `cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-resilience-policy.test.ts test/paw-context-budget.test.ts test/paw-risk-classifier.test.ts test/paw-budget-policy.test.ts test/paw-approval-policy.test.ts test/paw-session-store.test.ts test/paw-persistence.test.ts test/paw-state.test.ts test/paw-contracts.test.ts`: 92 tests passed.
- `rg -n "\bany\b|import\(" packages/coding-agent/src/paw packages/coding-agent/test/paw-*.test.ts`: no matches.
- `npm run check`: passed.
