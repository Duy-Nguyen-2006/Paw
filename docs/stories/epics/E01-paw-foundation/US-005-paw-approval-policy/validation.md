# Validation

## Proof Strategy

This story is complete when focused tests prove automatic R0-R2 allowance,
interactive R3-R6 approval requirement, non-interactive explicit allow behavior,
R7 never-auto behavior, non-interactive product approval fail-closed behavior,
and read-only write blocking. The root check must also pass.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | Risk ordering, tool approval decisions, product approval decisions. |
| Integration | Runtime config defaults drive the policy. |
| E2E | Not applicable; no CLI command yet. |
| Platform | Not applicable; no tool execution yet. |
| Performance | Not applicable for pure policy helpers. |
| Logs/Audit | Blocked decisions include code, message, and suggested action. |

## Fixtures

- `paw-spec/config.yaml`

## Commands

```text
cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-approval-policy.test.ts
npm run check
scripts/bin/harness-cli story verify US-005
```

## Acceptance Evidence

Implemented in `packages/coding-agent/src/paw/approval-policy.ts` with
coverage in `packages/coding-agent/test/paw-approval-policy.test.ts`.

- `cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-approval-policy.test.ts test/paw-session-store.test.ts test/paw-persistence.test.ts test/paw-state.test.ts test/paw-contracts.test.ts`: 36 tests passed.
- `rg -n "\bany\b|import\(" packages/coding-agent/src/paw packages/coding-agent/test/paw-*.test.ts`: no matches.
- `npm run check`: passed.
