# Validation

## Proof Strategy

US-052 is complete when `createPawNativeSubprocessExecutor` returns a
`PawNativeVerificationExecutor` that spawns real child processes, enforces
timeouts, captures stdout/stderr, and cleans up child processes on all exit
paths, without wiring the executor into the default CLI.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | Successful command returns exit code 0 with stdout capture; failing command returns non-zero exit code with stderr capture; timed-out command returns `timedOut: true` and is killed; non-existent command returns error result; stdout/stderr are captured as strings; no orphan processes after timeout kill. |
| Integration | Executor injected into `runPawNativeVerificationPlan` runs planned gates and produces verified/unverified runner results; adjacent plan, runner, and verify-command tests remain compatible. |
| E2E | Not applicable; full Paw orchestration is not implemented. |
| Platform | Subprocess behavior varies by OS signal handling; tests target Unix signal semantics (`SIGKILL`). |
| Performance | Not applicable; executor runs gates sequentially per the runner's iteration. |
| Logs/Audit | No logs are written; executor results carry exit code and captured output through the runner and result mapper. |

## Commands

```text
cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-verification-executor.test.ts test/paw-verification-runner.test.ts test/paw-verification-plan.test.ts test/paw-verify-command.test.ts
scripts/bin/harness-cli story verify US-052
npm run check
```

## Acceptance Evidence

- Focused verification-executor, verification-runner, verification-plan, and verify-command tests passed:
  `cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-verification-executor.test.ts test/paw-verification-runner.test.ts test/paw-verification-plan.test.ts test/paw-verify-command.test.ts`.
- Harness story verification passed: `scripts/bin/harness-cli story verify US-052`.
- Root repository check passed: `npm run check`.
