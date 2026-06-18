
# Validation

## Proof Strategy

US-068 is complete when `paw complete-verification <session-id> --decision-file <path>` reads and validates
verify decision JSON, acquires the session lock, completes verification through
`completePawVerification`, releases owned locks for applicable outcomes, preserves live foreign locks
for acquire-time `locked`, and routes through `handlePawCommand` / `main` before normal agent
runtime.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | Parser validation and result formatting. |
| Integration | Temp-project VERIFYING advance, invalid/missing decision file without lock, invalid state and no selected slice without mutation, invalid_verify_decisions mapping, missing project/session, and live foreign lock preservation. |
| E2E | `main(["paw","complete-verification",...])` routes before agent runtime without setting exit code. |
| Platform | Temp-directory filesystem checks for `.paw/`, locks, and session state persistence. |
| Performance | Not applicable; bounded file operations only. |
| Logs/Audit | Not applicable; structured stdout for operators. |

## Fixtures

- Runtime config copied from repository `paw-spec/config.yaml` into temporary test projects.
- Temporary `.paw/sessions/<id>/state.json`, `session.lock`, and verify decision JSON files.
- Deterministic lock timestamps and TTL values.

## Commands

```text
cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-verifier-result-command.test.ts test/paw-verifier-result.test.ts test/paw-reviewer-result-command.test.ts test/paw-init-command.test.ts
npm run check
scripts/bin/harness-cli story verify US-068
```

## Acceptance Evidence

- Focused complete-verification and related Paw session tests pass.
- Root repository check passes: `npm run check`.
- Harness story verification passes when `scripts/bin/harness-cli story verify US-068` is configured.
