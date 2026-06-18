
# Validation

## Proof Strategy

US-063 is complete when `paw select-slice <session-id>` acquires the session lock,
selects the next slice through `selectNextPawPlanSlice`, releases owned locks for
applicable outcomes, preserves live foreign locks for acquire-time `locked`, and
routes through `handlePawCommand` / `main` before normal agent runtime.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | Parser validation and result formatting. |
| Integration | Temp-project PLAN_APPROVED selection, no pending without mutation, invalid transition without mutation, missing project/session, and live foreign lock preservation. |
| E2E | `main(["paw","select-slice",...])` routes before agent runtime without setting exit code. |
| Platform | Temp-directory filesystem checks for `.paw/`, locks, and session state persistence. |
| Performance | Not applicable; bounded file operations only. |
| Logs/Audit | Not applicable; structured stdout for operators. |

## Fixtures

- Runtime config copied from repository `paw-spec/config.yaml` into temporary test projects.
- Temporary `.paw/sessions/<id>/state.json` and `session.lock` files.
- Deterministic lock timestamps and TTL values.

## Commands

```text
cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-slice-selection-command.test.ts test/paw-slice-selection.test.ts test/paw-plan-approval-command.test.ts test/paw-init-command.test.ts
npm run check
scripts/bin/harness-cli story verify US-063
```

## Acceptance Evidence

- Focused select-slice and related Paw session tests pass.
- Root repository check passes: `npm run check`.
- Harness story verification passes: `scripts/bin/harness-cli story verify US-063`.
