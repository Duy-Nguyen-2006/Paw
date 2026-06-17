# Execution Plan

1. Add failing tests for parser, result builder, and CLI routing.
2. Implement `slice-checkpoint-command.ts` with lock acquire, `preparePawSliceCheckpoint`,
   and owned lock release.
3. Wire `runPawPrepareCheckpointCommand` in `init-command.ts` and export from `index.ts`.
4. Add tests for prepared checkpoint, invalid state, no selected slice, parser errors,
   missing project/session, live foreign lock, and `main` routing.
5. Add US-064 story docs and `docs/TEST_MATRIX.md` row.
6. Run focused Vitest files from validation.

## Non-Goals

- Shadow worktree creation or rollback execution.
- Slice implementation start or worker/reviewer flows.
