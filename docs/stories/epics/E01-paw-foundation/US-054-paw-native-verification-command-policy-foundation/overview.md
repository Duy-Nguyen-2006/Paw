
# US-054: Paw Native Verification Command Policy Foundation

## Summary

Add a command-policy allowlist layer that gates native verification execution
so that only exact (gate, argv) pairs defined in the planned verification plan
are permitted to reach the subprocess executor. Commands that fail the policy
check receive an unverified-compatible executor result without spawning a child
process, preserving the safety boundary between plan authoring and execution.

## Scope

- Define a `PawNativeVerificationCommandPolicy` type that maps gate names to
  their permitted command argv arrays.
- Implement a `createPawPolicyCheckedNativeVerificationExecutor` factory that wraps an existing
  `PawNativeVerificationExecutor` (the subprocess executor from US-052) with
  allowlist enforcement.
- On each executor invocation, compare the incoming gate name and command argv
  against the policy. An exact match means the gate name exists in the policy
  and every element of the incoming argv matches the corresponding element in
  the policy entry (same length, same string values).
- When the policy check passes, delegate to the wrapped executor normally.
- When the policy check fails (gate not in policy, or argv does not match),
  return an `PawNativeVerificationExecutorResult` with a non-zero exit code
  (1), empty stdout, a descriptive stderr message, and no child process spawn.
- Derive the policy from the same `NATIVE_VERIFICATION_COMMANDS` record that
  `createPawNativeVerificationPlan` uses, so the allowlist is always in sync
  with the plan.
- Wire the policy executor into `runPawVerifyCommand` so that `--native`
  always passes through the policy layer before reaching the subprocess
  executor.
- Export the policy type and factory from the Paw package index.

## Acceptance Criteria

- A command whose gate name and argv exactly match a planned verification
  command passes through the policy and reaches the subprocess executor.
- A command whose gate name is not in the policy is blocked: no child process
  spawns, the result has `exitCode: 126`, stderr describes the policy violation,
  and the result is structurally compatible with `PawNativeVerificationExecutorResult`.
- A command whose gate name matches but argv differs from the policy entry is
  blocked with the same behavior.
- The policy is derived from the same source of truth as the verification plan
  (`NATIVE_VERIFICATION_COMMANDS` in `verification-plan.ts`).
- `paw verify <session-id> --native` uses the policy executor automatically;
  no additional CLI flag is required.
- The wrapped subprocess executor (US-052) is unchanged; the policy layer is
  a pure decorator.
- Focused tests, Harness story verification, and root `npm run check` pass.
