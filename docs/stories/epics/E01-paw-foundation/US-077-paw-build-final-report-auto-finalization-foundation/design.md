
# Design

## Loop Finalization

When `paw build <session-id> --max-steps <n>` stops because the final step returned `no_pending_slices`, the build loop acquires the session lock again and calls `emitPawFinalReport` with deterministic summary and evidence lines derived from the loop result.

## Verification Decisions

The loop aggregates `verifyDecisions` from verifier step results and forwards them into the final report. This preserves unverified gate disclosure from the existing non-native verification path.

## Stop Behavior

Only `no_pending_slices` triggers auto-finalization. Blocked, failed, locked, missing project/session, and `max_steps_reached` outcomes keep their previous stop behavior and do not write report artifacts.

## Out Of Scope

- Real provider execution.
- Native verification from `paw build`.
- Sandbox/tool runtime policy.
- Rollback or shadow worktree execution.
- SPEC/interview/planner execution.
