# Validation

## Proof Strategy

US-074 is complete when `paw build <session-id> --once` dispatches `VERIFYING` sessions to the existing verifier command path, advances the current slice to `SLICE_DONE` without native subprocess execution, writes empty non-native verification evidence, releases owned locks, and preserves US-072/US-073 worker and reviewer behavior.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | Parser validation, build result formatting, verifier gate summary formatting. |
| Integration | Temp-project `VERIFYING -> SLICE_DONE`, `completed_with_unverified`, empty `verification-evidence.json`, no native run results, missing project/session, invalid state, missing selected slice, live foreign lock preservation, and worker/reviewer regression coverage. |
| E2E | Existing `main(["paw","build",...])` route remains before agent runtime. |
| Platform | Temp-directory `.paw/` filesystem, locks, session state persistence, and verification evidence persistence. |
| Performance | Not applicable; bounded file operations only for verifier path. |
| Logs/Audit | Structured stdout for operator-facing command result. |

## Fixtures

- Runtime config copied from repository `paw-spec/config.yaml` into temporary test projects.
- Temporary `.paw/sessions/<id>/state.json`, `session.lock`, and `verification-evidence.json` files.
- No real provider calls and no native subprocess verification for `paw build`.

## Commands

```text
cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-build-command.test.ts
scripts/bin/harness-cli story verify US-074
npm run check
```

## Acceptance Evidence

- Focused build command tests pass.
- Harness story verification passes.
- Root repository check passes.
