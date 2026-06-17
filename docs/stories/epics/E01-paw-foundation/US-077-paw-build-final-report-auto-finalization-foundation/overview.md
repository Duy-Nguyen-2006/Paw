# US-077: Paw Build Final-Report Auto-Finalization Foundation

## Summary

Extend bounded `paw build <session-id> --max-steps <n>` loops so a successful no-pending-slices stop emits the existing final report artifacts and advances the session to `FINAL_REPORT`.

## Scope

- Auto-finalize only when a bounded build loop stops on `no_pending_slices`.
- Reuse existing final report emission logic and session lock handling.
- Preserve verifier decisions collected during the loop in the final report.
- Keep `--once`, blocked, failed, locked, missing, and max-step stop behavior unchanged.
- Do not add real provider execution, sandbox/tool runtime, rollback, or planner/SPEC automation.

## Acceptance Criteria

- A bounded loop that completes all pending slices writes `summary.md` and `report.json`.
- The session advances from `SLICE_DONE` to `FINAL_REPORT` after auto-finalization.
- Final report JSON preserves unverified verifier decisions from the loop.
- Max-step, blocked, failed, locked, and missing-session/project loop stops do not emit final reports.
- Existing one-step build behavior remains covered and passing.
