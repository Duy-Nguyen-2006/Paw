
# US-085: Paw Tool Runtime Dry-Run Contract Foundation

## Summary

Add a pure Paw tool-runtime evaluator that composes approval, sandbox, secret-path, and untrusted-source policies into dry-run-only allow/block decisions without executing tools.

## Scope

- Add `evaluatePawToolRuntimeRequest` and public request/decision types.
- Reuse existing approval policy for risk/run-mode decisions.
- Reuse existing sandbox policy for write-capable requests.
- Reuse existing secret path and untrusted source policy checks.
- Ensure every outcome reports `executed: false` and `filesChanged: false`.
- Add focused fake-only tests.
- Do not add CLI commands, subprocess execution, filesystem writes, sandbox launch, provider calls, or worker tool-loop integration.

## Acceptance Criteria

- Tests prove R0 read-only requests are allowed only as dry-run.
- Tests prove approval risks require exact non-interactive allow and R7 remains blocked.
- Tests prove write-capable requests require configured sandbox primitives.
- Tests prove secret paths and untrusted write-capable sources are blocked.
- Tests prove malformed requests return structured invalid decisions.
