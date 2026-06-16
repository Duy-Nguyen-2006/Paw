# Validation

## Proof Strategy

This story is complete when focused tests prove risk-level mapping,
config-backed trivial requirements, conservative standard escalation, high-risk
escalation for R3+ and security-sensitive signals, and reason reporting. The
root check must also pass.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | Risk scoring, max risk comparison, task class selection. |
| Integration | Default runtime config drives trivial classification. |
| E2E | Not applicable; no CLI command yet. |
| Platform | Not applicable; no process execution yet. |
| Performance | Not applicable for pure helpers. |
| Logs/Audit | Classification includes reasons. |

## Fixtures

- `paw-spec/config.yaml`

## Commands

```text
cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-risk-classifier.test.ts
npm run check
scripts/bin/harness-cli story verify US-007
```

## Acceptance Evidence

Implemented in `packages/coding-agent/src/paw/risk-classifier.ts` with
coverage in `packages/coding-agent/test/paw-risk-classifier.test.ts`.

- `cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-risk-classifier.test.ts test/paw-budget-policy.test.ts test/paw-approval-policy.test.ts test/paw-session-store.test.ts test/paw-persistence.test.ts test/paw-state.test.ts test/paw-contracts.test.ts`: 63 tests passed.
- `rg -n "\bany\b|import\(" packages/coding-agent/src/paw packages/coding-agent/test/paw-*.test.ts`: no matches.
- `npm run check`: passed.
