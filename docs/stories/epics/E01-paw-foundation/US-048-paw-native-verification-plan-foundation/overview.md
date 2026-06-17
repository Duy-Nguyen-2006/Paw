# US-048: Paw Native Verification Plan Foundation

## Summary

Add a deterministic planning layer for Paw native verification gates. The layer
maps configured v1 gate names to explicit command plans without executing them,
so `paw verify` can disclose which native gates are planned while continuing to
record the gates as unverified until execution is wired.

## Scope

- Add a pure native verification plan module.
- Map supported v1 gates to deterministic command argv arrays.
- Mark unknown gates as unsupported with explicit reasons.
- Surface the plan from `paw verify <session-id>` results and formatted output.
- Keep command execution disabled in this slice; no gate is marked verified.
- Export the planning helpers for future verifier runner work.

## Acceptance Criteria

- Configured v1 gate order is preserved in the generated plan.
- Supported gates include deterministic command argv arrays.
- Unsupported gates are explicit and do not throw.
- `paw verify` includes planned native gate metadata while persisting all gates
  as unverified.
- Focused tests, Harness story verification, and root `npm run check` pass.
