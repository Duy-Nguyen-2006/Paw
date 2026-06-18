
# Execution Plan

1. Add failing tests for parser, slice builder, result builder, and CLI routing.
2. Implement `plan-approval-command.ts` with lock acquire, `approvePawPlanSlices`,
   and owned lock release.
3. Wire `runPawApprovePlanCommand` in `init-command.ts` and export from `index.ts`.
4. Add tests for advanced transition, invalid transition, parser errors, missing
   project/session, live foreign lock, and `main` routing.
5. Add US-062 story docs and `docs/TEST_MATRIX.md` row.
6. Run focused Vitest files from validation.

## Non-Goals

- Running planner or worker execution.
- Interactive plan editing UX.
- Scout or spec approval flows.
