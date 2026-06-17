# Design

## Command

`paw build <session-id> --max-steps <n>` runs a bounded loop. Each loop iteration calls the existing one-step build implementation with `once: true`, so the loop reuses all existing lock, state transition, worker, reviewer, and verifier behavior.

## Stop Conditions

The loop stops when a step returns one of these terminal outcomes:

- `no_pending_slices` as `loop_completed`.
- `blocked` as `loop_stopped`.
- lock, missing project/session, validation, or sub-agent failure outcomes as `loop_stopped`.
- `max_steps_reached` after the configured step budget is exhausted.

## Out Of Scope

- Real provider execution.
- Native verification from `paw build`.
- Sandbox/tool runtime policy.
- Rollback or shadow worktree execution.
- Final report emission from the build loop.
