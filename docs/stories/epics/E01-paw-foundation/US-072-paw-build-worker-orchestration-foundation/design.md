
# Design

## Command

`paw build <session-id> --once` runs one bounded worker orchestration step. `--once` is required so this foundation
cannot accidentally imply the full multi-slice loop.

## Orchestration

`runPawWorkerOnce` owns the one-step flow:

1. Confirm `.paw/` and the requested session state file exist.
2. Acquire the session lock, preserving live foreign locks.
3. Require `IMPLEMENTING` with a non-null `current_slice_id`.
4. Build a worker runtime invocation with config-derived worker handoff cap and worker model route.
5. Invoke `runPawSubAgentRuntime`, retrying one invalid response.
6. Persist accepted `pass` output through `completePawWorkerPass`.
7. Persist accepted `blocked` or `needs_user_decision` output through `blockPawWorkerResult`.
8. Release owned locks for terminal outcomes.

## Default Executor

The CLI default executor intentionally returns a valid worker blocked output with `PROVIDER_UNAVAILABLE`. This preserves
liveness and honesty until real provider execution is implemented in a later slice.

## Out Of Scope

- Real hosted or local model calls.
- Scout, planner, reviewer, verifier, and full multi-slice orchestration.
- Sandbox and budget enforcement beyond already existing policy helpers.
