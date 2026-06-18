
# Execution Plan

1. Add failing tests for `createPawStartCommandResult` and CLI routing.
2. Implement `start-command.ts` with result builder, formatter, and runner.
3. Wire `runPawStartCommand` in `init-command.ts` and export from `index.ts`.
4. Add tests for started, existing, live lock, stale reclaim, parser errors, and `main` routing.
5. Add US-061 story docs and `docs/TEST_MATRIX.md` row.
6. Run focused Vitest files from validation.

## Non-Goals

- Running the full Paw orchestrator loop.
- Provider, scout, planner, worker, reviewer, or verifier execution.
- Interactive resume UX beyond reporting current state.
