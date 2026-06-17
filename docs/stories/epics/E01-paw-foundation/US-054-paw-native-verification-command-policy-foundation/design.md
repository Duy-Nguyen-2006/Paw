# Design

## Domain Model

US-054 introduces `verification-command-policy.ts`:

- `PawNativeVerificationCommandPolicy` is a `ReadonlyMap<string, readonly string[]>`
  mapping gate names to their exact permitted command argv.
- `createPawNativeVerificationCommandPolicy` derives the policy from the same
  `NATIVE_VERIFICATION_COMMANDS` record used by `createPawNativeVerificationPlan`,
  producing a policy map whose keys are gate names and whose values are the
  corresponding command arrays.
- `createPawPolicyCheckedNativeVerificationExecutor` accepts a
  `PawNativeVerificationCommandPolicy` and a `PawNativeVerificationExecutor`
  (the wrapped subprocess executor), and returns a new
  `PawNativeVerificationExecutor`.

## Policy Enforcement

When the policy executor is invoked with a `PawNativeVerificationExecutorInput`:

1. Look up `input.gate` in the policy map.
2. If the gate is not found, return a blocked result immediately:
   `{ exitCode: 126, stdout: "", stderr: "Command policy violation: gate ... is not in the allowed verification plan." }`.
3. If the gate is found, compare `input.command` element-by-element with the
   policy entry. If lengths differ or any element differs, return a blocked
   result: `{ exitCode: 126, stdout: "", stderr: "Command policy violation: ... does not match the allowed command for gate ..." }`.
4. If the command matches exactly, delegate to the wrapped executor and return
   its result unchanged.

The comparison is strict: no prefix matching, no path resolution, no
normalization. The argv arrays produced by the verification plan are already
canonical, so exact string comparison is sufficient.

## Application Flow

1. `runPawVerifyCommand` detects `--native`.
2. Instead of calling `createPawNativeSubprocessExecutor` directly, it calls
   `createPawPolicyCheckedNativeVerificationExecutor` with the policy and the subprocess executor.
3. The policy executor is passed as the `nativeVerificationExecutor` on
   `PawVerifyCommandInput`.
4. `createPawVerifyCommandResult` runs the verification plan through the runner
   (US-049) with the policy-wrapped executor.
5. For each planned gate, the runner calls the policy executor with the gate's
   command argv from the plan.
6. The policy executor checks the gate+argv against the policy. Since the plan
   itself generated the gate+argv from `NATIVE_VERIFICATION_COMMANDS`, and the
   policy is derived from the same source, all planned gates pass through.
7. If a future caller attempted to invoke the executor with an unexpected gate
   or argv, the policy blocks it.

## Safety Boundaries

- The policy layer is a pure decorator; it does not modify the subprocess
  executor (US-052) or the runner (US-049).
- The policy is derived from `NATIVE_VERIFICATION_COMMANDS`, which is the same
  data source as the verification plan. This ensures plan and policy are always
  in sync without manual maintenance.
- Blocked commands produce a result structurally identical to a failed
  execution (`exitCode: 126`, stderr message, no stdout). The runner and result
  mapper (US-050) process this as an unverified gate, which is the correct
  semantics for a policy violation.
- No child process is spawned for blocked commands, eliminating any risk of
  unintended code execution.
- The policy does not implement sandbox (bwrap/Landlock) enforcement; that
  remains a separate concern per ADR-18.
- The policy does not implement AGENTS constraint integration; that is a
  future slice.

## Alternatives Considered

1. Embed the allowlist check inside the subprocess executor.
   - Rejected because the executor (US-052) is a general-purpose subprocess
     spawner. Policy enforcement is a separate concern that should decorate
     any executor implementation, not be coupled to one.
2. Implement the policy check in the runner (US-049).
   - Rejected because the runner is responsible for plan iteration and result
     collection, not command authorization. Mixing concerns would violate the
     single-responsibility boundary established across US-048 through US-053.
3. Load the allowlist from `paw.yaml` or an external configuration.
   - Rejected because the verification plan commands are already defined in
     code (`NATIVE_VERIFICATION_COMMANDS`). An external allowlist would need
     to stay in sync with code changes and adds configuration complexity
     without a current use case. Config-driven policy can be added later.
4. Use glob or regex matching for argv comparison.
   - Rejected because the planned commands are exact and static. Flexible
     matching increases the attack surface without benefit for the known
     command set.
5. Return a distinct result type (e.g. `policy_violation`) instead of an
   `exitCode: 126` result.
   - Rejected because the runner and result mapper already handle non-zero
     exit codes as unverified. Introducing a new status would require changes
     to the runner, mapper, and result types for no additional safety benefit.
