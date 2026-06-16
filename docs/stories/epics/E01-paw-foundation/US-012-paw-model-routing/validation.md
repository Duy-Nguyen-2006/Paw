# Validation

## Proof Strategy

This story is complete when focused tests prove role routing, model/provider
resolution, thinking gate behavior, and failover target ordering. The root
check must also pass.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | Role-to-tier mapping, thinking gates, failover routes. |
| Integration | Default runtime config drives model IDs and provider targets. |
| E2E | Not applicable; no provider calls yet. |
| Platform | Not applicable; no network execution yet. |
| Performance | Not applicable for pure helpers. |
| Logs/Audit | Resolved routes include reportable tier/provider/model. |

## Fixtures

- `paw-spec/config.yaml`

## Commands

```text
cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-model-routing.test.ts
npm run check
scripts/bin/harness-cli story verify US-012
```

## Acceptance Evidence

Implemented in `packages/coding-agent/src/paw/model-routing.ts` with coverage
in `packages/coding-agent/test/paw-model-routing.test.ts`.

- `cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-model-routing.test.ts test/paw-security-policy.test.ts test/paw-edit-policy.test.ts test/paw-resilience-policy.test.ts test/paw-context-budget.test.ts test/paw-risk-classifier.test.ts test/paw-budget-policy.test.ts test/paw-approval-policy.test.ts test/paw-session-store.test.ts test/paw-persistence.test.ts test/paw-state.test.ts test/paw-contracts.test.ts`: 118 tests passed.
- `rg -n "\bany\b|import\(" packages/coding-agent/src/paw packages/coding-agent/test/paw-*.test.ts`: no matches.
- `npm run check`: passed.
