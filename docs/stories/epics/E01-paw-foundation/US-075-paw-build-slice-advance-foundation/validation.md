
# Validation

## Proof Strategy

US-075 is complete when `paw build <session-id> --once` advances coordinator states around slice execution through existing locked helpers while keeping one bounded step per invocation.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | Parser validation and build result formatting for coordinator outcomes. |
| Integration | Temp-project `PLAN_APPROVED -> SLICE_SELECT`, `SLICE_SELECT -> IMPLEMENTING`, `SLICE_DONE -> SLICE_SELECT`, `SLICE_DONE` with no pending slices, missing project/session, invalid state, missing selected slice, live foreign lock preservation, and worker/reviewer/verifier regression coverage. |
| E2E | Existing `main(["paw","build",...])` route remains before agent runtime. |
| Platform | Temp-directory `.paw/` filesystem, locks, session state persistence, and verification evidence persistence. |
| Performance | Not applicable; one bounded transition per invocation. |
| Logs/Audit | Structured stdout for operator-facing command result. |

## Fixtures

- Runtime config copied from repository `paw-spec/config.yaml` into temporary test projects.
- Temporary `.paw/sessions/<id>/state.json`, `session.lock`, slice journals, and verification evidence files.
- Injected worker and reviewer outputs for regression coverage, no real provider calls.

## Commands

```text
cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-build-command.test.ts
scripts/bin/harness-cli story verify US-075
npm run check
```

## Acceptance Evidence

- Focused build command tests pass.
- Harness story verification passes.
- Root repository check passes.
