
# Validation

## Proof Strategy

This story is complete when focused tests prove diff-first selection,
fuzzy retry caps, full-file rewrite size limits, blocked patch failure behavior,
and idempotency no-op/base-drift decisions. The root check must also pass.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | Next edit method, retry cap, size cap, idempotency outcomes. |
| Integration | Default runtime config drives retry and line-count limits. |
| E2E | Not applicable; no patch application yet. |
| Platform | Not applicable; no file system writes yet. |
| Performance | Not applicable for pure helpers. |
| Logs/Audit | Blocks include message and suggested action. |

## Fixtures

- `paw-spec/config.yaml`

## Commands

```text
cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-edit-policy.test.ts
npm run check
scripts/bin/harness-cli story verify US-010
```

## Acceptance Evidence

Implemented in `packages/coding-agent/src/paw/edit-policy.ts` with coverage in
`packages/coding-agent/test/paw-edit-policy.test.ts`.

- `cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-edit-policy.test.ts test/paw-resilience-policy.test.ts test/paw-context-budget.test.ts test/paw-risk-classifier.test.ts test/paw-budget-policy.test.ts test/paw-approval-policy.test.ts test/paw-session-store.test.ts test/paw-persistence.test.ts test/paw-state.test.ts test/paw-contracts.test.ts`: 102 tests passed.
- `rg -n "\bany\b|import\(" packages/coding-agent/src/paw packages/coding-agent/test/paw-*.test.ts`: no matches.
- `npm run check`: passed.
