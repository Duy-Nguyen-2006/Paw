
# Execution Plan

1. Add failing tests for parser, result builder, and CLI routing.
2. Implement `slice-selection-command.ts` with lock acquire, `selectNextPawPlanSlice`,
   and owned lock release.
3. Wire `runPawSelectSliceCommand` in `init-command.ts` and export from `index.ts`.
4. Add tests for advanced transition, no pending slices, invalid transition, parser
   errors, missing project/session, live foreign lock, and `main` routing.
5. Add US-063 story docs and `docs/TEST_MATRIX.md` row.
6. Run focused Vitest files from validation.

## Non-Goals

- Worker, reviewer, or verifier execution after slice selection.
- Checkpoint creation or slice implementation start.
- Interactive slice queue editing.
