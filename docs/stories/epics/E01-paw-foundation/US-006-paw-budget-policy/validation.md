
# Validation

## Proof Strategy

This story is complete when focused tests prove task warn/exceed behavior,
interactive approval behavior, non-interactive fail-closed behavior, per-slice
soft-budget behavior, and config-backed limits. The root check must also pass.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | Utilization math, task budget decisions, slice budget decisions. |
| Integration | Default runtime config budget values drive the policy. |
| E2E | Not applicable; no CLI command yet. |
| Platform | Not applicable; no process execution yet. |
| Performance | Not applicable for pure policy helpers. |
| Logs/Audit | Budget blocks include code, message, and suggested action. |

## Fixtures

- `paw-spec/config.yaml`

## Commands

```text
cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-budget-policy.test.ts
npm run check
scripts/bin/harness-cli story verify US-006
```

## Acceptance Evidence

Implemented in `packages/coding-agent/src/paw/budget-policy.ts` with coverage
in `packages/coding-agent/test/paw-budget-policy.test.ts`.

- `cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-budget-policy.test.ts test/paw-approval-policy.test.ts test/paw-session-store.test.ts test/paw-persistence.test.ts test/paw-state.test.ts test/paw-contracts.test.ts`: 46 tests passed.
- `rg -n "\bany\b|import\(" packages/coding-agent/src/paw packages/coding-agent/test/paw-*.test.ts`: no matches.
- `npm run check`: passed.
