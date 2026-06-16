# Validation

## Proof Strategy

This story is complete when focused tests prove sandbox fallback decisions,
read-only forcing without sandbox, unsafe override behavior, secret path
exclusion, redaction classification, and untrusted-source handling. The root
check must also pass.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | Sandbox selection, risk gating, path exclusion, redaction classification. |
| Integration | Default runtime config drives preferred sandbox and secret patterns. |
| E2E | Not applicable; no tool execution yet. |
| Platform | Not applicable; no sandbox process launch yet. |
| Performance | Not applicable for pure helpers. |
| Logs/Audit | Blocks and redactions include reasons. |

## Fixtures

- `paw-spec/config.yaml`

## Commands

```text
cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-security-policy.test.ts
npm run check
scripts/bin/harness-cli story verify US-011
```

## Acceptance Evidence

Implemented in `packages/coding-agent/src/paw/security-policy.ts` with coverage
in `packages/coding-agent/test/paw-security-policy.test.ts`.

- `cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-security-policy.test.ts test/paw-edit-policy.test.ts test/paw-resilience-policy.test.ts test/paw-context-budget.test.ts test/paw-risk-classifier.test.ts test/paw-budget-policy.test.ts test/paw-approval-policy.test.ts test/paw-session-store.test.ts test/paw-persistence.test.ts test/paw-state.test.ts test/paw-contracts.test.ts`: 110 tests passed.
- `rg -n "\bany\b|import\(" packages/coding-agent/src/paw packages/coding-agent/test/paw-*.test.ts`: no matches.
- `npm run check`: passed.
