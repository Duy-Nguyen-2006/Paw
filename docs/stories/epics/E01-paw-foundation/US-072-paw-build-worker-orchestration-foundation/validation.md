# Validation

## Proof Strategy

US-072 is complete when `paw build <session-id> --once` invokes one worker runtime step for an `IMPLEMENTING` session,
persists pass or blocked worker outputs through existing transition helpers, retries invalid JSON once, releases owned
locks, preserves live foreign locks, and routes before normal agent runtime.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | Parser validation, result formatting, default fail-closed executor output. |
| Integration | Temp-project `IMPLEMENTING -> REVIEWING`, `IMPLEMENTING -> BLOCKED_*`, invalid JSON retry, exhausted invalid JSON to `BLOCKED_CONTEXT_MISSING`, missing project/session, invalid state, missing selected slice, and live foreign lock preservation. |
| E2E | `main(["paw","build",...])` routes before agent runtime without setting exit code. |
| Platform | Temp-directory `.paw/` filesystem, locks, session state, and journal persistence. |
| Performance | Not applicable; bounded file operations and injected executor only. |
| Logs/Audit | Structured stdout for operator-facing command result. |

## Fixtures

- Runtime config copied from repository `paw-spec/config.yaml` into temporary test projects.
- Temporary `.paw/sessions/<id>/state.json`, `session.lock`, and journal files.
- Injected worker executor outputs, no real provider calls.

## Commands

```text
cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-build-command.test.ts
scripts/bin/harness-cli story verify US-072
./test.sh
npm run check
```

## Acceptance Evidence

- Focused build command tests pass.
- Harness story verification passes.
- Root repository check passes.
- `./test.sh` was attempted and is blocked before this story's tests by existing workspace package resolution for `@earendil-works/pi-ai` when `packages/agent` tests import it without built `dist`.
