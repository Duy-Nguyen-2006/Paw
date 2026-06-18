
# Validation

## Proof Strategy

US-071 is complete when `paw block-verifier <session-id> --decision-file <path>` reads and validates
verify decision JSON, acquires the session lock, records the blocked result through `blockPawVerifierResult`,
releases owned locks for applicable outcomes, preserves live foreign locks for acquire-time `locked`,
and routes through `handlePawCommand` / `main` before normal agent runtime.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | Parser validation and result formatting. |
| Integration | Temp-project VERIFYING advance to BLOCKED_*, invalid/missing output file without lock, invalid state and no selected slice without mutation, invalid_blocked_decisions, invalid_blocked_decisions, invalid_blocked_reason, missing project/session, and live foreign lock preservation. |
| E2E | `main(["paw","block-verifier",...])` routes before agent runtime without setting exit code. |
| Platform | Temp-directory filesystem checks for `.paw/`, locks, and session state persistence. |
| Performance | Not applicable; bounded file operations only. |
| Logs/Audit | Not applicable; structured stdout for operators. |

## Fixtures

- Runtime config copied from repository `paw-spec/config.yaml` into temporary test projects.
- Temporary `.paw/sessions/<id>/state.json`, `session.lock`, and verify decision JSON files.
- Deterministic lock timestamps and TTL values.

## Commands

```text
cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-verifier-blocked-command.test.ts test/paw-verifier-blocked-result.test.ts test/paw-verifier-result-command.test.ts test/paw-init-command.test.ts
npm run check
scripts/bin/harness-cli story verify US-071
```

## Acceptance Evidence

- Focused block-verifier and related Paw session tests pass.
- Root repository check passes: `npm run check`.
- Harness story verification passes when `scripts/bin/harness-cli story verify US-071` is configured.
