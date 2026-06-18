
# Design

## Domain Model

US-050 introduces `verification-runner.ts`:

- `mapPawNativeVerificationRunResults` accepts runner results and a
  `PawVerifyConfig` and returns `PawVerifyGateDecision[]` in the same order.
- Verified runner outcomes produce `PawVerifyGateDecision` entries with
  `status: "verified"` and `verified: true`, with `applicable` and
  `gateSet` resolved from config.
- Unverified runner outcomes produce `PawVerifyGateDecision` entries with
  `status: "unverified"`, `verified: false`, and the runner reason carried
  forward.
- The function is pure: no I/O, no child processes, no provider calls.

## Application Flow

1. A caller runs the native verification plan through the injected executor
   and collects `PawNativeVerificationRunResult[]`.
2. The caller passes runner results and the project's `PawVerifyConfig` to
   `mapPawNativeVerificationRunResults`.
3. The mapper resolves each gate's `gateSet` and `applicable` fields from
   config using the existing `evaluatePawVerifyGate` contract, passing
   `available: true` when the runner reported verified and `available: false`
   otherwise.
4. The resulting `PawVerifyGateDecision[]` can be forwarded to
   `completePawVerification` for persistence.

## Safety Boundaries

This slice does not wire the mapper into `paw verify`, does not spawn native
processes, does not run package scripts, and does not mark real project gates
as verified. Shell execution, sandbox enforcement, and command allowlist
policy remain future integration slices.

## Alternatives Considered

1. Merge the mapper into `verification-runner.ts`.
   - Rejected because the runner owns execution semantics and the mapper owns
     policy translation; separating them keeps each module focused and testable.
2. Bypass `evaluatePawVerifyGate` and construct decisions directly.
   - Rejected because `evaluatePawVerifyGate` already resolves `gateSet` and
     `applicable`; duplicating that logic risks drift.
3. Add a `PawNativeVerificationRunResult`-to-`PawVerifyGateDecision` method
   on the runner result type.
   - Rejected because result types are plain data; policy mapping belongs in a
     dedicated pure function.
