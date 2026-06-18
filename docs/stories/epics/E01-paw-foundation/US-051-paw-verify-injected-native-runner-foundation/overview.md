
# US-051: Paw Verify Injected Native Runner Foundation

## Summary

Wire the native verification runner and result mapper into the `paw verify`
command helper through an injected executor, so that callers who provide a
real executor can run planned gates and persist honest verified or unverified
decisions. The default CLI remains non-executing until real shell runner
policy is implemented.

## Scope

- Accept an optional `PawNativeVerificationExecutor` on
  `createPawVerifyCommandResult` input.
- When an executor is provided, run the native verification plan through
  the runner, map outcomes through the result mapper, and persist the
  resulting `PawVerifyGateDecision[]` records.
- When no executor is provided, preserve the current non-executing foundation
  behavior where all gates are marked unverified with plan reasons.
- Export the updated `PawVerifyCommandInput` type carrying the executor field.
- Keep the default CLI entry point (`runPawVerifyCommand`) non-executing.

## Acceptance Criteria

- Injecting an executor causes `paw verify` to execute planned gates, map
  runner outcomes into verified or unverified `PawVerifyGateDecision` records,
  and persist them through the existing verification transition.
- Verified runner outcomes produce verified gate decisions.
- Non-zero exit codes, timeouts, and unsupported gates produce unverified
  gate decisions with explicit reasons.
- Omitting the executor preserves the current foundation behavior where all
  gates are unverified.
- The default CLI path does not inject an executor.
- No production code invokes shell commands directly in this slice.
- Focused tests, Harness story verification, and root `npm run check` pass.
