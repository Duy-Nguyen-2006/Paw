# Validation

## Proof Strategy

US-033 is complete when the core helper persists valid transitions only under
current lock ownership, refuses invalid transitions without writing, refuses
missing, stale, and foreign locks without writing, and preserves blocked-state
entry/resume semantics through persisted state.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | Result discrimination, current-owner matching, invalid-transition issue propagation, and blocked-state resume shape. |
| Integration | Temp-project `.paw/` session state read/write, live-lock owner checks, stale-lock no-write, missing-lock no-write, and atomic next-state persistence. |
| E2E | Not applicable; no full interactive Paw workflow is implemented. |
| Platform | Covered by temp-directory filesystem checks for `.paw/` state and lock files. |
| Performance | Not applicable; helper performs bounded file operations. |
| Logs/Audit | Not applicable; helper returns structured metadata for future runtime and CLI callers. |

## Fixtures

- Runtime config copied from repository `paw-spec/config.yaml` into temporary
  test projects.
- Temporary `.paw/sessions/<id>/state.json` and `session.lock` files.
- Deterministic lock timestamps, TTL values, and owner metadata.

## Commands

```text
cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-task-session.test.ts
npm run check
scripts/bin/harness-cli story verify US-033
```

## Acceptance Evidence

- Focused task-session test passed:
  `cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-task-session.test.ts`
  with 9 tests passing.
- Root repository check passed: `npm run check`.
- Harness story verification passed:
  `scripts/bin/harness-cli story verify US-033`.
