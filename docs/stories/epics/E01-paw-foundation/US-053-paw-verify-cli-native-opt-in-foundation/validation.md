
# Validation

## Proof Strategy

US-053 is complete when `runPawVerifyCommand` accepts a `--native` flag,
creates a subprocess executor, and passes it to `createPawVerifyCommandResult`
so that native verification gates execute, while omitting `--native` preserves
the non-executing foundation path. No production code outside
`verify-command.ts` changes.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | `--native` flag is detected in args; session id is extracted correctly when `--native` is present; unknown flag-like args (`--bad`) are rejected as errors; `--help`/`-h` alongside session id or `--native` prints help; subprocess executor is constructed with cwd; executor is passed to `createPawVerifyCommandResult`; help text includes `--native`. |
| Integration | `paw verify <session-id> --native` with a real temp-project session runs gates through the subprocess executor and produces verified/unverified decisions; `paw verify <session-id>` without `--native` produces all-unverified decisions; session state advances from VERIFYING to SLICE_DONE in both cases; adjacent runner, executor, plan, and verify-command tests remain compatible. |
| E2E | Not applicable; full Paw orchestration is not implemented. |
| Platform | Subprocess behavior covered by US-052; this slice adds no new platform-specific behavior. |
| Performance | Not applicable; executor runs gates sequentially per the runner's iteration. |
| Logs/Audit | No logs are written; results carry exit codes and captured output through the runner and result mapper as in US-051/US-052. |

## Commands

```text
cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-verify-command.test.ts test/paw-verification-executor.test.ts test/paw-verification-runner.test.ts test/paw-verification-plan.test.ts
scripts/bin/harness-cli story verify US-053
npm run check
```

## Acceptance Evidence

- `parsePawVerifyArgs` tightened: unknown flag-like args rejected as errors;
  `--help`/`-h` takes priority over session id and `--native`.
- Focused verify-command, verification-executor, verification-runner, and verification-plan tests passed:
  `cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-verify-command.test.ts test/paw-verification-executor.test.ts test/paw-verification-runner.test.ts test/paw-verification-plan.test.ts`.
- Harness story verification passed: `scripts/bin/harness-cli story verify US-053`.
- Root repository check passed: `npm run check`.
