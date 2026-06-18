
# Validation

## Proof Strategy

US-054 is complete when `createPawPolicyCheckedNativeVerificationExecutor` wraps an existing
executor with allowlist enforcement so that only exact (gate, argv) pairs from
the planned verification command set reach the subprocess executor, and blocked
commands return unverified-compatible results without spawning child processes.
The policy is derived from the verification plan and wired into the `--native`
CLI path.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | Policy executor allows matching gate+argv through to wrapped executor; policy executor blocks unknown gate name with exit code 126 and descriptive stderr; policy executor blocks mismatched argv with exit code 126 and descriptive stderr; blocked result has correct `PawNativeVerificationExecutorResult` shape (exitCode, stdout, stderr fields); policy derived from `createPawNativeVerificationPlan` contains exactly the planned gate set; empty command argv is blocked; policy is a pure decorator (wrapped executor result passes through unchanged on match). |
| Integration | `paw verify <session-id> --native` constructs the subprocess executor and wraps it with the command policy via `createPawPolicyCheckedNativeVerificationExecutor`; policy-derived plan has at least one planned entry; a policy that blocks all commands prevents any subprocess calls and produces unverified gates; adjacent verification-runner, verification-executor, verification-plan, and verify-command tests remain compatible. |
| E2E | Not applicable; full Paw orchestration is not implemented. |
| Platform | Not applicable; policy is pure in-process logic with no platform-specific behavior. |
| Performance | Not applicable; policy check is a map lookup and array comparison per gate. |
| Logs/Audit | No logs are written; policy violations produce stderr in the executor result, which flows through the runner and result mapper as unverified gate reasons. |

## Commands

```text
cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-verification-command-policy.test.ts test/paw-verify-command.test.ts
npm run check
```

## Acceptance Evidence

- `paw-verify-command.test.ts`: "--native flag wraps subprocess executor with policy derived from verification plan" verifies `createPawNativeVerificationCommandPolicy` is called with the plan, `createPawPolicyCheckedNativeVerificationExecutor` is called once, and the policy plan has planned entries.
- `paw-verify-command.test.ts`: "--native policy-blocked command does not reach subprocess executor" verifies that a blocking policy prevents all subprocess calls and produces unverified gates.
- `paw-verification-command-policy.test.ts`: full policy allowlist/block coverage including exact match pass-through, mismatched gate blocking, mismatched argv blocking, empty command blocking, multiple gates, and shape compatibility.
- Default path without `--native` is unchanged: no subprocess executor constructed, all gates unverified.
