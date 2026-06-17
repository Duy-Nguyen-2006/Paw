# Validation

## Proof Strategy

US-061 is complete when `paw start <session-id>` initializes `.paw` when needed,
starts or resumes through `startPawTaskSession`, releases owned locks for
`started` and `existing`, preserves live foreign locks for `locked`, and routes
through `handlePawCommand` / `main` before normal agent runtime.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | Result formatting and parser validation for help, missing id, `-` prefix, and unknown options. |
| Integration | Temp-project start, existing resume, live foreign lock, stale reclaim, and lock release verification. |
| E2E | `main(["paw","start",...])` routes before agent runtime without setting exit code. |
| Platform | Temp-directory filesystem checks for `.paw/`, locks, and session state persistence. |
| Performance | Not applicable; bounded file operations only. |
| Logs/Audit | Not applicable; structured stdout for operators. |

## Fixtures

- Runtime config copied from repository `paw-spec/config.yaml` into temporary test projects.
- Temporary `.paw/sessions/<id>/state.json` and `session.lock` files.
- Deterministic lock timestamps and TTL values.

## Commands

```text
cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-start-command.test.ts test/paw-task-session.test.ts test/paw-session-store.test.ts test/paw-init-command.test.ts test/paw-resume-command.test.ts
npm run check
scripts/bin/harness-cli story verify US-061
```

## Acceptance Evidence

- Focused start-command and related Paw session tests pass.
- Root repository check passes: `npm run check`.
- Harness story verification passes: `scripts/bin/harness-cli story verify US-061`.
