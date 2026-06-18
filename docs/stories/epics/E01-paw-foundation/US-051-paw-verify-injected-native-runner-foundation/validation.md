
# Validation

## Proof Strategy

US-051 is complete when `createPawVerifyCommandResult` accepts an optional
injected executor, runs the native verification plan through the runner when
an executor is provided, maps outcomes into `PawVerifyGateDecision` records,
persists them through the existing verification transition, and preserves
the non-executing foundation path when no executor is provided.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | Injected executor receives planned gate commands; verified exit code produces verified gate decision; non-zero exit code produces unverified decision with reason; timeout produces unverified decision; unsupported gate produces unverified decision. |
| Integration | `paw verify` temp-project flow with injected executor produces verified and unverified decisions; `paw verify` without executor preserves current foundation behavior with all gates unverified; session state advances from VERIFYING to SLICE_DONE in both cases. |
| E2E | Not applicable; full Paw orchestration is not implemented. |
| Platform | Covered by temp-directory CLI session state and lock behavior in adjacent verify command tests. |
| Performance | Not applicable; runner executes gates sequentially through the injected adapter. |
| Logs/Audit | No logs are written; runner outcomes carry reasons and summarized output through the result mapper. |

## Commands

```text
cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-verify-command.test.ts test/paw-verification-runner.test.ts test/paw-verification-plan.test.ts
scripts/bin/harness-cli story verify US-051
npm run check
```

## Acceptance Evidence

- Focused Vitest passed:
  `cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-verify-command.test.ts test/paw-verification-runner.test.ts test/paw-verification-plan.test.ts`.
- Harness story verification passed: `scripts/bin/harness-cli story verify US-051`.
- Root repository check passed: `npm run check`.
