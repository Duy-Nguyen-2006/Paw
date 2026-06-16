# Validation

## Proof Strategy

This story is complete when focused tests prove config-backed class caps,
sub-agent handoff caps, file-read and tool-output decisions, required-span
escalation, and stable-first assembly order. The root check must also pass.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | Context cap lookup, file/tool inclusion decisions, handoff decisions. |
| Integration | Default runtime config drives limits and assembly order. |
| E2E | Not applicable; no CLI command yet. |
| Platform | Not applicable; no process execution yet. |
| Performance | Not applicable for pure helpers. |
| Logs/Audit | Escalations include message and suggested action. |

## Fixtures

- `paw-spec/config.yaml`

## Commands

```text
cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-context-budget.test.ts
npm run check
scripts/bin/harness-cli story verify US-008
```

## Acceptance Evidence

Implemented in `packages/coding-agent/src/paw/context-budget.ts` with coverage
in `packages/coding-agent/test/paw-context-budget.test.ts`.

- `cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-context-budget.test.ts test/paw-risk-classifier.test.ts test/paw-budget-policy.test.ts test/paw-approval-policy.test.ts test/paw-session-store.test.ts test/paw-persistence.test.ts test/paw-state.test.ts test/paw-contracts.test.ts`: 79 tests passed.
- `rg -n "\bany\b|import\(" packages/coding-agent/src/paw packages/coding-agent/test/paw-*.test.ts`: no matches.
- `npm run check`: passed.
