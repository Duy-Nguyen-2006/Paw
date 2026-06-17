# Validation

## Proof Strategy

US-050 is complete when native verification runner outcomes can be translated
into `PawVerifyGateDecision` records through a pure mapping function: verified
runner results produce verified decisions; unverified, unsupported, and timed-out
runner results produce unverified decisions with reasons preserved.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | Verified mapping, unverified mapping, unsupported mapping, timeout mapping, exit-code reason preservation, config gate-set resolution, applicable field correctness. |
| Integration | Adjacent plan, runner, and verify-command tests ensure the mapping contract remains compatible with existing planning, running, and CLI foundation. |
| E2E | Not applicable; full Paw orchestration is not implemented. |
| Platform | Not applicable in this slice because no child process is spawned. |
| Performance | Not applicable; mapping is in-memory over runner results. |
| Logs/Audit | No logs are written; mapped decisions carry reasons and summarized output from the runner. |

## Commands

```text
cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-verification-runner.test.ts test/paw-verification-plan.test.ts test/paw-verify-command.test.ts
scripts/bin/harness-cli story verify US-050
npm run check
```

## Acceptance Evidence

- Focused verification-runner, verification-plan, and verify-command tests passed:
  `cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-verification-runner.test.ts test/paw-verification-plan.test.ts test/paw-verify-command.test.ts`.
- Harness story verification passed: `scripts/bin/harness-cli story verify US-050`.
- Root repository check passed: `npm run check`.
