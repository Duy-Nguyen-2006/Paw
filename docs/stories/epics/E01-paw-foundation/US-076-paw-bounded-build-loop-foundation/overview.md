
# US-076: Paw Bounded Build Loop Foundation

## Summary

Add a bounded `paw build <session-id> --max-steps <n>` loop that repeatedly invokes the existing one-step build orchestration and stops safely on terminal outcomes.

## Scope

- Add `--max-steps <n>` parser support while keeping `--once` unchanged.
- Require exactly one of `--once` or `--max-steps`.
- Reuse existing one-step build behavior for coordinator, worker, reviewer, and verifier states.
- Stop on `no_pending_slices`, blocked results, failures, lock/session/project errors, or max steps.
- Format loop summaries for operator-facing output.

## Acceptance Criteria

- `--max-steps` accepts positive integers and rejects invalid or conflicting inputs.
- A bounded loop can advance through coordinator and sub-agent phases using injected worker/reviewer outputs.
- The loop stops at max steps before unbounded continuation.
- The loop completes when no pending slices remain.
- The loop stops on provider-unavailable blocked results without real provider execution.
- Existing `--once` behavior remains covered and passing.
