# Execution Plan

1. Add a failing focused test for command policy enforcement: a policy
   executor wrapping a mock subprocess executor allows a matching gate+argv
   pair through; a non-matching gate name is blocked with `exitCode: 126` and
   no subprocess call; a matching gate with wrong argv is blocked with
   `exitCode: 126` and no subprocess call; a blocked result is structurally
   compatible with `PawNativeVerificationExecutorResult`.
2. Add a focused test confirming the policy is derived from
   `NATIVE_VERIFICATION_COMMANDS` and contains every gate the plan produces
   with `status: "planned"`.
3. Add a focused test confirming `paw verify <session-id> --native` uses the
   policy-wrapped executor (i.e. the policy factory is called in the CLI
   wiring path).
4. Implement `verification-command-policy.ts` with
   `createPawNativeVerificationCommandPolicy` and
   `createPawPolicyCheckedNativeVerificationExecutor`.
5. Update `runPawVerifyCommand` in `verify-command.ts` to construct the
   policy executor wrapping the subprocess executor when `--native` is active.
6. Export the policy type and factory from the Paw package index.
7. Add story and test-matrix evidence.
8. Verify with focused Vitest, Harness story verification, adjacent
   runner/executor/plan/verify tests, GitNexus detect-changes, and root
   `npm run check`.

## Non-Goals

- Sandbox (bwrap/Landlock) enforcement.
- AGENTS command-policy integration.
- Config-driven allowlist (external policy source).
- Glob or regex matching for argv.
- Distinct result type for policy violations.
- Modifying the subprocess executor (US-052) or runner (US-049).
- Parallel gate execution.
- Per-gate working directory or environment overrides.
