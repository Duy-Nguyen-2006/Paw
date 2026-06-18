
# Design

## Domain Model

US-051 modifies `verify-command.ts`:

- `PawVerifyCommandInput` gains an optional `nativeVerificationExecutor` field
  of type `PawNativeVerificationExecutor`.
- When `nativeVerificationExecutor` is provided, `createPawVerifyCommandResult`
  runs the native verification plan through `runPawNativeVerificationPlan`, then
  maps outcomes through `mapPawNativeVerificationRunResults` to produce
  `PawVerifyGateDecision[]`.
- When `nativeVerificationExecutor` is omitted, the existing non-executing
  foundation path continues: every gate is marked unverified with a plan reason.

## Application Flow

1. `paw verify <session-id>` loads configured v1 gates and creates the native
   verification plan.
2. If an executor is injected, the plan runs through
   `runPawNativeVerificationPlan` in plan order.
3. Runner results are mapped to `PawVerifyGateDecision[]` through
   `mapPawNativeVerificationRunResults`.
4. If no executor is injected, each plan entry produces an unverified gate
   decision with `available: false` (current foundation behavior).
5. `completePawVerification` persists the decisions and advances the session
   state from VERIFYING to SLICE_DONE.
6. The default CLI entry point `runPawVerifyCommand` does not inject an
   executor, keeping the CLI non-executing.

## Safety Boundaries

This slice does not implement a real shell executor, does not spawn child
processes, does not enforce sandbox or timeout policy, and does not change the
default CLI behavior. The executor injection point exists solely for test and
future integration use.

## Alternatives Considered

1. Wire a real child-process executor directly into `verify-command.ts`.
   - Rejected because AGENTS command-policy integration, sandbox enforcement,
     and output summarization need separate slices.
2. Replace `createFoundationVerifyDecisions` entirely.
   - Rejected because the non-executing fallback path must remain for the
     default CLI until real shell runner policy is implemented.
3. Accept the executor at `runPawVerifyCommand` level.
   - Rejected because `createPawVerifyCommandResult` is the reusable entry
     point for both CLI and programmatic callers; injection belongs there.
