# Validation

## Proof Strategy

US-049 is complete when planned native verification entries can be evaluated
through an injected executor and all outcomes remain honest: pass is verified;
unsupported, failing, and timed-out gates are unverified with reasons.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | Executor call order, pass, non-zero failure, timeout, unsupported gate, output truncation. |
| Integration | Adjacent plan and verify command tests ensure the runner contract remains compatible with current planning and CLI foundation. |
| E2E | Not applicable; full Paw orchestration is not implemented. |
| Platform | Not applicable in this slice because no child process is spawned. |
| Performance | Output summaries are bounded by caller-provided character limits. |
| Logs/Audit | No logs are written; runner results carry reasons and summarized output. |

## Commands

```text
cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-verification-runner.test.ts test/paw-verification-plan.test.ts test/paw-verify-command.test.ts
scripts/bin/harness-cli story verify US-049
npm run check
```

## Acceptance Evidence

- Focused verification-runner, verification-plan, and verify-command tests
  passed:
  `cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-verification-runner.test.ts test/paw-verification-plan.test.ts test/paw-verify-command.test.ts`.
- Harness story verification passed: `scripts/bin/harness-cli story verify US-049`.
- Root repository check passed: `npm run check`.
