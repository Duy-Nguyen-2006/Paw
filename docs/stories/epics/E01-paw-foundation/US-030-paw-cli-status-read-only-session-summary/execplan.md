# Exec Plan

## Goal

Implement the bounded `pi paw status` CLI summary without enabling write-capable
Paw runtime behavior.

## Scope

In scope:

- Add a status command module.
- Add a pure report formatter and report helper.
- Route `pi paw status` and `pi paw status --help` through the existing Paw
  handler.
- Report missing `.paw/` as a successful status result.
- Read `.paw/config.yaml`, `.paw/version`, and session state files without
  writing files or acquiring locks.
- Add focused Vitest coverage for missing `.paw`, initialized with no sessions,
  valid and invalid sessions, help, unknown options, and main routing.
- Update story docs and test matrix evidence.

Out of scope:

- Editing `packages/coding-agent/src/main.ts`.
- Full Paw command set completion.
- Standalone `paw` executable routing.
- Runtime orchestration, provider execution, sandbox execution, or lock
  mutation.
- JSON output.

## Risk Classification

Risk flags:

- Public contract, because a new CLI command route is exposed.
- Existing behavior, because the Paw handler route expands.
- Weak proof, because GitNexus impact is unavailable for the new untracked Paw
  handler/status symbols in this worktree.

Hard gates:

- None. The prompt narrows the slice to read-only status reporting and forbids
  editing high-impact `main.ts`.

Lane: normal, bounded by read-only behavior and focused tests.

## Work Phases

1. Read required Paw CLI, persistence, config, state, session-store, tests,
   runtime docs, and matrix files.
2. Record degraded impact context through Harness tool lookup.
3. Add the focused status command tests.
4. Implement the status report helper, formatter, and handler route.
5. Update story packet and matrix evidence.
6. Run focused Vitest, root check, and Harness story verification.
7. Record durable story proof.

## Stop Conditions

Pause for human confirmation if:

- The command would need to create `.paw/`, sessions, locks, or artifacts.
- The implementation would require editing `packages/coding-agent/src/main.ts`.
- The implementation would need to start provider-backed runtime behavior.
