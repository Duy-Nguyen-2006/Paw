# Validation

## Proof Strategy

This story is complete when focused tests prove append/read behavior, absent
journal behavior, malformed-line errors, and applied-change lookup. The root
check must also pass.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | Entry validation and lookup helpers. |
| Integration | Temporary `.paw/sessions/<id>/slice-journal.jsonl` append/read. |
| E2E | Not applicable; no CLI command yet. |
| Platform | Filesystem JSONL persistence in temp directories. |
| Performance | Not applicable for small journal helpers. |
| Logs/Audit | Malformed JSONL errors include line numbers. |

## Fixtures

- Temporary directory.

## Commands

```text
cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-slice-journal.test.ts
npm run check
scripts/bin/harness-cli story verify US-013
```

## Acceptance Evidence

Implemented in `packages/coding-agent/src/paw/slice-journal.ts` with coverage
in `packages/coding-agent/test/paw-slice-journal.test.ts`.

- `cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-slice-journal.test.ts test/paw-model-routing.test.ts test/paw-security-policy.test.ts test/paw-edit-policy.test.ts test/paw-resilience-policy.test.ts test/paw-context-budget.test.ts test/paw-risk-classifier.test.ts test/paw-budget-policy.test.ts test/paw-approval-policy.test.ts test/paw-session-store.test.ts test/paw-persistence.test.ts test/paw-state.test.ts test/paw-contracts.test.ts`: 125 tests passed.
- `rg -n "\bany\b|import\(" packages/coding-agent/src/paw packages/coding-agent/test/paw-*.test.ts`: no matches.
- `npm run check`: passed.
