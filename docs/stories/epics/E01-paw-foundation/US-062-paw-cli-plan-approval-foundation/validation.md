
# Validation

## Proof Strategy

US-062 is complete when `paw approve-plan <session-id> --slice ...` acquires the
session lock, approves plan slices through `approvePawPlanSlices`, releases owned
locks for applicable outcomes, preserves live foreign locks for acquire-time `locked`,
and routes through `handlePawCommand` / `main` before normal agent runtime.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | Parser validation, CLI slice builder order/title rules, and result formatting. |
| Integration | Temp-project PLAN_DRAFTED approval, invalid transition without mutation, missing project/session, and live foreign lock preservation. |
| E2E | `main(["paw","approve-plan",...])` routes before agent runtime without setting exit code. |
| Platform | Temp-directory filesystem checks for `.paw/`, locks, and session state persistence. |
| Performance | Not applicable; bounded file operations only. |
| Logs/Audit | Not applicable; structured stdout for operators. |

## Fixtures

- Runtime config copied from repository `paw-spec/config.yaml` into temporary test projects.
- Temporary `.paw/sessions/<id>/state.json` and `session.lock` files.
- Deterministic lock timestamps and TTL values.

## Commands

```text
cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-plan-approval-command.test.ts test/paw-plan-approval.test.ts test/paw-plan-slices.test.ts test/paw-task-session.test.ts test/paw-session-store.test.ts test/paw-init-command.test.ts
npm run check
scripts/bin/harness-cli story verify US-062
```

## Acceptance Evidence

- Focused approve-plan and related Paw session tests pass.
- Root repository check passes: `npm run check`.
- Harness story verification passes: `scripts/bin/harness-cli story verify US-062`.
