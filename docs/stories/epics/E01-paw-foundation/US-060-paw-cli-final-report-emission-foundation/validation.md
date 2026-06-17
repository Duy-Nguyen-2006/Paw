# Validation

## Proof Strategy

US-060 is complete when `paw finalize` safely emits final report artifacts for
`SLICE_DONE` sessions under the session lock and surfaces clear errors for
validation, lock, and state failures.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | Parser validation, result formatting, default evidence, empty verifyDecisions path. |
| Integration | Temp-project init, SLICE_DONE state, lock acquire/release, live foreign lock, wrong state, artifact writes, `handlePawCommand` and `main` routing. |
| E2E | Not applicable. |
| Platform | Temp-directory `.paw` session paths. |

## Commands

```text
cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-finalize-command.test.ts test/paw-final-report-emission.test.ts test/paw-report-command.test.ts test/paw-session-store.test.ts test/paw-init-command.test.ts
scripts/bin/harness-cli story verify US-060
npm run check
```

## Acceptance Evidence

- Focused finalize and adjacent Paw tests pass per commands above.
- Harness story verification for US-060 passes.
- Root `npm run check` passes.
