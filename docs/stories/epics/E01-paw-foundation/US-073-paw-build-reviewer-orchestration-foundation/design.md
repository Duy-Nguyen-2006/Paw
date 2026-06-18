
# Design

## Command

`paw build <session-id> --once` now chooses the one-step orchestration role from persisted session state:

- `IMPLEMENTING` uses worker orchestration from US-072.
- `REVIEWING` uses reviewer orchestration from this story.
- Other states continue to surface structured invalid-state results through the existing worker path.

## Reviewer Orchestration

`runPawReviewerOnce` owns the one-step reviewer flow:

1. Confirm `.paw/` and the requested session state file exist.
2. Acquire the session lock, preserving live foreign locks.
3. Require `REVIEWING` with a non-null `current_slice_id`.
4. Build a reviewer runtime invocation with config-derived reviewer handoff cap and reviewer model route.
5. Invoke `runPawSubAgentRuntime`, retrying one invalid response.
6. Persist accepted `pass` output through `completePawReviewerPass`.
7. Persist accepted `blocked` or `needs_user_decision` output through `blockPawReviewerResult`.
8. Release owned locks for terminal outcomes.

## Default Executor

The CLI default executor returns a valid role-matched blocked output with `PROVIDER_UNAVAILABLE`. This keeps the command
honest and resumable until real provider execution is implemented.

## Out Of Scope

- Verifier orchestration.
- Full multi-slice loop.
- Real hosted or local model calls.
- Sandbox, approval, and budget enforcement beyond existing policy helpers.
