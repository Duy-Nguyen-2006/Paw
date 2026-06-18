
# Validation

## Proof Strategy

This story is complete when focused unit tests prove initial state creation,
valid state progression, invalid transition rejection, slice completion, and
blocked-state metadata. The root check must also pass.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | Initial state, allowed transitions, invalid transitions, slice completion, blocked state reason. |
| Integration | Root `npm run check` passes after code changes. |
| E2E | Not applicable; no CLI behavior yet. |
| Platform | Not applicable; persistence and sandbox are later slices. |
| Performance | Not applicable for pure state helpers. |
| Logs/Audit | Blocked states carry message and suggested action fields. |

## Fixtures

- In-memory Paw session state objects.

## Commands

```text
cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-state.test.ts
npm run check
scripts/bin/harness-cli story verify US-002
```

## Acceptance Evidence

- `cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-state.test.ts test/paw-contracts.test.ts`
  passed: 11 tests in 2 files.
- `npm run check` passed from the repository root with no fixes applied on the
  final run.
- `scripts/bin/harness-cli story verify US-002` passed.
