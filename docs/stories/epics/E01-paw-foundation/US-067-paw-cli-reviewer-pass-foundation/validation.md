
# Validation

## Proof Strategy

US-067 is complete when `paw complete-reviewer <session-id> --output-file <path>` reads and validates
reviewer output JSON, acquires the session lock, completes the reviewer pass through
`completePawReviewerPass`, releases owned locks for applicable outcomes, preserves live foreign locks
for acquire-time `locked`, and routes through `handlePawCommand` / `main` before normal agent
runtime.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | Parser validation and result formatting. |
| Integration | Temp-project REVIEWING advance, invalid/missing output file without lock, invalid state and no selected slice without mutation, reviewer_not_passed and invalid_reviewer_output, missing project/session, and live foreign lock preservation. |
| E2E | `main(["paw","complete-reviewer",...])` routes before agent runtime without setting exit code. |
| Platform | Temp-directory filesystem checks for `.paw/`, locks, and session state persistence. |
| Performance | Not applicable; bounded file operations only. |
| Logs/Audit | Not applicable; structured stdout for operators. |

## Fixtures

- Runtime config copied from repository `paw-spec/config.yaml` into temporary test projects.
- Temporary `.paw/sessions/<id>/state.json`, `session.lock`, and reviewer output JSON files.
- Deterministic lock timestamps and TTL values.

## Commands

```text
cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-reviewer-result-command.test.ts test/paw-reviewer-result.test.ts test/paw-worker-result-command.test.ts test/paw-init-command.test.ts
npm run check
scripts/bin/harness-cli story verify US-067
```

## Acceptance Evidence

- Focused complete-reviewer and related Paw session tests pass.
- Root repository check passes: `npm run check`.
- Harness story verification passes when `scripts/bin/harness-cli story verify US-067` is configured.
