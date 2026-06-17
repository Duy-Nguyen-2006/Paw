# Execution Plan

1. Add failing tests for `parsePawFinalizeArgs` and completed finalize path.
2. Implement `finalize-command.ts` with parser, result builder, formatter, runner.
3. Wire `runPawFinalizeCommand` in `init-command.ts` and export from `index.ts`.
4. Add tests for missing project/session, live lock, wrong state, routing, main.
5. Add US-060 story docs and `docs/TEST_MATRIX.md` row.
6. Run focused Vitest files from validation.

## Non-Goals

- Loading verify decisions from session state (not persisted today).
- Full orchestrator auto-finalize after last slice.
- Interactive approval or budget gates on finalize.
