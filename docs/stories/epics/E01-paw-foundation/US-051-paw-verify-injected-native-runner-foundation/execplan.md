# Execution Plan

1. Add a failing focused test for injected executor wiring in the verify
   command: a fake executor runs planned gates and the completed result
   carries verified and unverified decisions from the runner and mapper.
2. Add a focused test confirming the non-executing foundation path remains
   when no executor is injected.
3. Update `createPawVerifyCommandResult` to accept an optional
   `PawNativeVerificationExecutor` on the input type.
4. When an executor is present, run the plan through
   `runPawNativeVerificationPlan`, map outcomes through
   `mapPawNativeVerificationRunResults`, and pass the resulting decisions
   to `completePawVerification`.
5. When no executor is present, preserve the existing
   `createFoundationVerifyDecisions` non-executing path.
6. Export the updated types from the Paw package index.
7. Add story and test-matrix evidence.
8. Verify with focused Vitest, Harness story verification, adjacent
   plan/runner/verify tests, GitNexus detect-changes, and root
   `npm run check`.

## Non-Goals

- Implementing a real shell executor.
- Sandbox enforcement or timeout policy.
- Command allowlist integration.
- Parallel native verifier execution.
- Changing the default CLI behavior.
