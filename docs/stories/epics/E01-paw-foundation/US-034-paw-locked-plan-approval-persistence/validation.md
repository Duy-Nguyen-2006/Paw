# Validation

## Proof Strategy

US-034 is complete when the core helper validates planner slices before state
writes, persists ordered pending slice ids only through a valid locked
`PLAN_APPROVED` transition, propagates lock and transition failures without
writing state, and exposes the ordered queue for future callers.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | Result discrimination, invalid planner issue propagation, queue ordering, and transition result preservation. |
| Integration | Temp-project `.paw/` session state read/write, live-lock owner checks through `advancePawTaskSession`, missing-lock no-write, invalid-transition no-write, and ordered pending slice persistence. |
| E2E | Not applicable; no full interactive Paw workflow is implemented. |
| Platform | Covered by temp-directory filesystem checks for `.paw/` state and lock files. |
| Performance | Not applicable; helper performs bounded validation and file operations. |
| Logs/Audit | Not applicable; helper returns structured metadata for future runtime and CLI callers. |

## Fixtures

- Runtime config copied from repository `paw-spec/config.yaml` into temporary
  test projects.
- Temporary `.paw/sessions/<id>/state.json` and `session.lock` files.
- Deterministic lock timestamps, TTL values, owner metadata, and unordered
  planner slice inputs.

## Commands

```text
cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-plan-approval.test.ts
npm run check
scripts/bin/harness-cli story verify US-034
```

## Acceptance Evidence

- Focused plan-approval test passed:
  `cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-plan-approval.test.ts`
  with 4 tests passing.
- Root repository check passed: `npm run check`.
- Harness story verification passed:
  `scripts/bin/harness-cli story verify US-034`.
