# Exec Plan

## Goal

Add the `.paw` persistence foundation required by SPEC §12.

## Scope

In scope:

- Idempotent `.paw` directory initialization.
- Default durable files and directories.
- `.paw/.gitignore` from runtime config policy.
- Atomic JSON write/read helpers for future session state.
- Focused tests.

Out of scope:

- Public CLI command wiring.
- Lock heartbeat and stale-lock recovery.
- Schema migrations.
- Shadow worktree snapshots.

## Risk Classification

Risk flags:

- Data model.
- Public contracts.
- Existing behavior.
- Weak proof.

Hard gates:

- Data persistence contract. This slice must not overwrite existing files.

## Work Phases

1. Add focused tests for idempotent initialization and atomic writes.
2. Implement additive persistence helpers under `packages/coding-agent/src/paw/`.
3. Export helpers from the Paw barrel.
4. Run focused tests and `npm run check`.
5. Update durable story evidence and trace.

## Stop Conditions

Pause for human confirmation if:

- Initialization would need to delete or overwrite existing files.
- Existing `pi` CLI behavior must change.
- The `.paw` gitignore policy needs to diverge from `paw-spec/config.yaml`.
