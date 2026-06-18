
# Validation

## Proof Strategy

This story is complete when focused tests prove deterministic ordering,
duplicate rejection, empty plan rejection, field validation, and integration
with the existing state transition queue. The root check must also pass.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | Ordering, duplicate ids/orders, invalid fields. |
| Integration | Queue feeds `PLAN_APPROVED` and `SLICE_SELECT` state transitions. |
| E2E | Not applicable; no orchestrator loop execution yet. |
| Platform | Not applicable. |
| Performance | Not applicable for small plan arrays. |
| Logs/Audit | Validation issues include planner path locations. |

## Fixtures

- In-memory planner slices.

## Commands

```text
cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-plan-slices.test.ts
npm run check
scripts/bin/harness-cli story verify US-019
```

## Acceptance Evidence

- `cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-plan-slices.test.ts` passed with 7 tests.
- Focused Paw suite through US-019 passed with 19 files and 166 tests.
- Root `npm run check` passed after a local type-narrowing fix.
- Harness story verification passed for US-019.
