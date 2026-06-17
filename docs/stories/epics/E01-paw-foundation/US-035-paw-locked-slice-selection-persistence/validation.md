# Validation

## Proof Strategy

US-035 is complete when the core helper persists `SLICE_SELECT` only through a
current session lock, selects the next pending slice without redoing completed
slices, reports no pending slices without writing state, and propagates lock or
transition failures without writes.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | Result discrimination, selected slice id extraction, no-pending mapping, and invalid-transition propagation. |
| Integration | Temp-project `.paw/` session state read/write, current-lock owner checks through `advancePawTaskSession`, missing/stale/foreign lock no-write paths, and persisted pending/current/completed slice updates. |
| E2E | Not applicable; no full interactive Paw workflow is implemented. |
| Platform | Covered by temp-directory filesystem checks for `.paw/` state and lock files. |
| Performance | Not applicable; helper performs one bounded locked transition. |
| Logs/Audit | Not applicable; helper returns structured metadata for future runtime and CLI callers. |

## Fixtures

- Runtime config copied from repository `paw-spec/config.yaml` into temporary
  test projects.
- Temporary `.paw/sessions/<id>/state.json` and `session.lock` files.
- Deterministic lock timestamps, TTL values, owner metadata, pending slices,
  and completed slice lists.

## Commands

```text
cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-slice-selection.test.ts test/paw-plan-approval.test.ts test/paw-task-session.test.ts test/paw-state.test.ts
scripts/bin/harness-cli story verify US-035
npm run check
```

## Acceptance Evidence

- Focused slice-selection and adjacent Paw state/session tests passed:
  `cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-slice-selection.test.ts test/paw-plan-approval.test.ts test/paw-task-session.test.ts test/paw-state.test.ts`
  with 24 tests passing.
- Harness story verification passed:
  `scripts/bin/harness-cli story verify US-035`.
- Root repository check passed: `npm run check`.
