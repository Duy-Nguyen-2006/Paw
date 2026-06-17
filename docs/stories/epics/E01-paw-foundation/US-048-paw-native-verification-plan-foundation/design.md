# Design

## Domain Model

US-048 introduces `verification-plan.ts`:

- `PawNativeVerificationPlanEntry` describes either a planned native command or
  an unsupported gate.
- `createPawNativeVerificationPlan` maps gate names to stable argv arrays.
- `formatPawNativeVerificationCommand` renders argv for human-readable reasons.

The plan is intentionally non-executing. It is a contract between configured
verification gates and a future runner, not proof that any gate passed.

## Application Flow

1. `paw verify <session-id>` loads configured v1 gates from `paw-spec/config.yaml`.
2. It creates a native verification plan in config order.
3. It converts each plan entry into an unverified `PawVerifyGateDecision` with
   the plan reason.
4. It persists the existing verifier transition through `completePawVerification`.
5. It returns and formats the native plan alongside verified and unverified gate
   summaries.

## Safety Boundaries

This slice does not run shell commands, tests, build commands, linters, package
manager commands, or provider calls. It only records deterministic command plans
and keeps all gate decisions unverified.

## Alternatives Considered

1. Execute commands immediately from the plan.
   - Rejected because runner timeout, output summary, command allowlist, and
     AGENTS command-policy integration need a separate slice.
2. Keep the plan private to `verify-command.ts`.
   - Rejected because future runner and tests need a reusable, pure contract.
