
# US-050: Paw Native Verification Result Mapping Foundation

## Summary

Add a pure mapping layer that converts native verification runner outcomes into
`PawVerifyGateDecision` records so future CLI wiring can persist actual
verified or unverified gate results honestly, without running shell commands.

## Scope

- Add a result-mapping module that translates `PawNativeVerificationRunResult`
  entries into `PawVerifyGateDecision` records.
- Verified runner outcomes produce verified gate decisions.
- Unverified runner outcomes produce unverified gate decisions that preserve
  the runner reason, execution status, and exit code.
- The mapper reads gate-set membership from config so each decision carries
  the correct `gateSet` and `applicable` fields.
- Export the mapping helper for future `paw verify` runner integration.
- Keep the mapper non-executing; it does not spawn processes, run tests, or
  invoke provider calls.

## Acceptance Criteria

- A verified runner result maps to a verified `PawVerifyGateDecision`.
- An unverified runner result maps to an unverified `PawVerifyGateDecision`
  with the runner reason preserved.
- Unsupported runner results remain unverified with the original reason.
- Timeout runner results remain unverified with a timeout reason.
- Each decision carries the correct `gateSet` and `applicable` fields from
  configured v1 and v2 gate sets.
- The mapper does not invoke shell commands directly.
- Focused tests, Harness story verification, and root `npm run check` pass.
