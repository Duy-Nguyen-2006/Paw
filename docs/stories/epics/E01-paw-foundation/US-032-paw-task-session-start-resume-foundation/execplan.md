# Exec Plan

## Goal

Implement the Paw task-session start/resume foundation as a core helper without
adding CLI routing or orchestrator execution.

## Scope

In scope:

- Add `startPawTaskSession`.
- Add explicit input and result types.
- Initialize `.paw/` idempotently from runtime config.
- Acquire the session lock before reading or writing state.
- Return `locked` for live locks without writing state.
- Return `existing` for valid persisted state without overwriting it.
- Create initial state, transition it to `INTAKE`, and write it atomically when
  no state exists.
- Surface malformed existing state as an error.
- Export only the new helper and types from the Paw barrel.
- Add focused Vitest coverage.
- Update story docs and test matrix evidence.

Out of scope:

- Editing CLI command files or `packages/coding-agent/src/main.ts`.
- Full Paw CLI spec/build/resume completion.
- Full Paw runtime orchestrator loop.
- Provider-backed execution.
- User-facing resume command UX.

## Risk Classification

Risk flags:

- Existing behavior, because this composes existing Paw persistence, state, and
  lock primitives.
- Weak proof, because Harness has no present impact-analysis provider and
  GitNexus cannot see untracked Paw symbols in this worktree.

Hard gates:

- None. The helper is additive, does not expose a CLI route, and does not
  change existing persistence or lock behavior.

Lane: normal, bounded by additive helper scope and focused tests.

## Work Phases

1. Read required Paw persistence, config, state, session-store, tests, runtime
   docs, and matrix files.
2. Record degraded impact context through Harness tool lookup.
3. Add focused start/resume tests.
4. Implement the core helper and barrel exports.
5. Update story packet and matrix evidence.
6. Run focused Vitest, root check, and Harness story verification.
7. Record durable story proof.

## Stop Conditions

Pause for human confirmation if:

- The implementation would need CLI command routing.
- The implementation would need to edit `packages/coding-agent/src/main.ts`.
- The implementation would need to overwrite malformed session state.
- The implementation would need to run provider-backed Paw runtime behavior.
