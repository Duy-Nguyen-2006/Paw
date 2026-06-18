
# Validation

## Proof Strategy

US-032 is complete when the core helper starts a missing session, resumes a
valid existing session without overwriting it, returns a structured lock result
for live locks without writing state, reclaims stale locks through the existing
lock helper, and rejects malformed existing state with a useful error.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | Result discrimination, initial `IDLE -> INTAKE` transition, and malformed-state error formatting. |
| Integration | Temp-project `.paw/` initialization, lock acquisition, state read/write, live-lock no-write, and stale-lock reclaim. |
| E2E | Not applicable; no full interactive Paw workflow is implemented. |
| Platform | Covered by temp-directory filesystem checks for `.paw/` files, locks, and atomic session state persistence. |
| Performance | Not applicable; helper performs bounded file operations. |
| Logs/Audit | Not applicable; helper returns structured metadata for future runtime and CLI callers. |

## Fixtures

- Runtime config copied from repository `paw-spec/config.yaml` into temporary
  test projects.
- Temporary `.paw/sessions/<id>/state.json` and `session.lock` files.
- Deterministic lock timestamps and TTL values.

## Commands

```text
cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-task-session.test.ts
npm run check
scripts/bin/harness-cli story verify US-032
```

## Acceptance Evidence

- Focused task-session test passed:
  `cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-task-session.test.ts`
  with 5 tests passing.
- Root repository check passed: `npm run check`.
- Harness story verification passed:
  `scripts/bin/harness-cli story verify US-032`.
