
# US-049: Paw Native Verification Runner Foundation

## Summary

Add a bounded native verification runner contract that executes planned Paw
verification commands only through an injected executor and converts executor
results into honest verified or unverified outcomes.

## Scope

- Add a pure runner module for native verification plans.
- Require an injected executor so tests do not run real shell commands.
- Pass timeout metadata to the executor.
- Convert zero exit codes to verified outcomes.
- Convert non-zero exit codes, unsupported gates, and timeouts to unverified
  outcomes with explicit reasons.
- Summarize command output before returning it.
- Export runner types and helpers for future CLI wiring.

## Acceptance Criteria

- Planned gates are executed in plan order through the injected executor.
- Unsupported gates are not executed and become unverified.
- Exit code `0` becomes verified.
- Non-zero exit codes become unverified with summarized output.
- Timeout results become unverified with a timeout reason.
- No production code invokes shell commands directly in this slice.
- Focused tests, Harness story verification, and root `npm run check` pass.
