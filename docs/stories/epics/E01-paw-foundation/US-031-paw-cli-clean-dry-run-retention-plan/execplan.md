
# Exec Plan

## Goal

Implement the bounded `pi paw clean --dry-run` retention plan command without
enabling destructive Paw cleanup.

## Scope

In scope:

- Add a clean command module.
- Add pure-ish report creation and formatting helpers for tests.
- Route `pi paw clean --dry-run` and `pi paw clean --help` through the existing
  Paw handler.
- Reject bare `pi paw clean` without deleting anything.
- Report missing `.paw/` as a successful dry-run with zero candidates.
- Scan immediate `.paw/sessions/*` and `.paw/artifacts/*` directories.
- Convert directory mtimes into retention records.
- Call the existing `createPawRetentionPlan`.
- Add focused Vitest coverage for missing `.paw`, removable sessions/artifacts,
  bare clean rejection, help, and main routing.
- Update story docs and test matrix evidence.

Out of scope:

- Editing `packages/coding-agent/src/main.ts`.
- Destructive cleanup.
- Approval semantics for deletion.
- Full Paw command set completion.
- Standalone `paw` executable routing.
- Runtime orchestration, provider execution, sandbox execution, or lock
  mutation.
- JSON output.

## Risk Classification

Risk flags:

- Public contract, because a new CLI command route is exposed.
- Existing behavior, because the Paw handler route expands.
- Weak proof, because Harness has no present impact-analysis provider and
  GitNexus cannot see untracked Paw symbols in this worktree.

Hard gates:

- None. The prompt narrows the slice to read-only dry-run behavior and forbids
  editing high-impact `main.ts`.

Lane: normal, bounded by read-only behavior and focused tests.

## Work Phases

1. Read required Paw CLI, retention, persistence, config, tests, runtime docs,
   and matrix files.
2. Record degraded impact context through Harness tool lookup.
3. Add the focused clean command tests.
4. Implement the clean report helper, formatter, and handler route.
5. Update story packet and matrix evidence.
6. Run focused Vitest, root check, and Harness story verification if configured.
7. Record durable story proof.

## Stop Conditions

Pause for human confirmation if:

- The command would need to delete files or directories.
- The implementation would require editing `packages/coding-agent/src/main.ts`.
- The implementation would need to start provider-backed runtime behavior.
