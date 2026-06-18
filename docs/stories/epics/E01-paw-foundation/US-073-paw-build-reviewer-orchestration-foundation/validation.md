
# Validation

## Proof Strategy

US-073 is complete when `paw build <session-id> --once` invokes one reviewer runtime step for a `REVIEWING` session,
persists pass or blocked reviewer outputs through existing transition helpers, retries invalid JSON once, releases owned
locks, preserves live foreign locks, and preserves the US-072 worker path.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | Parser validation, result formatting, default fail-closed executor output. |
| Integration | Temp-project `REVIEWING -> VERIFYING`, `REVIEWING -> BLOCKED_*`, invalid reviewer JSON retry, exhausted invalid JSON to `BLOCKED_CONTEXT_MISSING`, missing project/session, invalid state, missing selected slice, live foreign lock preservation, and existing worker path regression coverage. |
| E2E | Existing `main(["paw","build",...])` route remains before agent runtime. |
| Platform | Temp-directory `.paw/` filesystem, locks, and session state persistence. |
| Performance | Not applicable; bounded file operations and injected executor only. |
| Logs/Audit | Structured stdout for operator-facing command result. |

## Fixtures

- Runtime config copied from repository `paw-spec/config.yaml` into temporary test projects.
- Temporary `.paw/sessions/<id>/state.json` and `session.lock` files.
- Injected reviewer executor outputs, no real provider calls.

## Commands

```text
cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-build-command.test.ts
scripts/bin/harness-cli story verify US-073
npm run check
```

## Acceptance Evidence

- Focused build command tests pass.
- Harness story verification passes.
- Root repository check passes.
