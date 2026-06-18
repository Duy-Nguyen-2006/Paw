
# Validation

## Proof Strategy

US-069 is complete when `paw block-worker <session-id> --output-file <path>` reads and validates
worker output JSON, acquires the session lock, records the blocked result through `blockPawWorkerResult`,
releases owned locks for applicable outcomes, preserves live foreign locks for acquire-time `locked`,
and routes through `handlePawCommand` / `main` before normal agent runtime.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | Parser validation and result formatting. |
| Integration | Temp-project IMPLEMENTING advance to BLOCKED_*, invalid/missing output file without lock, invalid state and no selected slice without mutation, worker_not_blocked, invalid_worker_output, invalid_blocked_reason, missing project/session, and live foreign lock preservation. |
| E2E | `main(["paw","block-worker",...])` routes before agent runtime without setting exit code. |
| Platform | Temp-directory filesystem checks for `.paw/`, locks, and session state persistence. |
| Performance | Not applicable; bounded file operations only. |
| Logs/Audit | Not applicable; structured stdout for operators. |

## Fixtures

- Runtime config copied from repository `paw-spec/config.yaml` into temporary test projects.
- Temporary `.paw/sessions/<id>/state.json`, `session.lock`, and worker output JSON files.
- Deterministic lock timestamps and TTL values.

## Commands

```text
cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-worker-blocked-command.test.ts test/paw-worker-blocked-result.test.ts test/paw-worker-result-command.test.ts test/paw-init-command.test.ts
npm run check
scripts/bin/harness-cli story verify US-069
```

## Acceptance Evidence

- Focused block-worker and related Paw session tests pass.
- Root repository check passes: `npm run check`.
- Harness story verification passes when `scripts/bin/harness-cli story verify US-069` is configured.
