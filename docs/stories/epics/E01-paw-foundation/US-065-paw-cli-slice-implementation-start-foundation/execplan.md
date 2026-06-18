
# Execution Plan

1. Implement `slice-implementation-command.ts` mirroring `slice-selection-command.ts`
   lock-before-domain-call and release-after-outcome flow.
2. Wire `handlePawCommand` and root `printPawHelp` in `init-command.ts`.
3. Export public types and functions from `index.ts`.
4. Add `paw-slice-implementation-command.test.ts` with parser, integration, routing,
   and `main` coverage.
5. Update `docs/TEST_MATRIX.md` and story `validation.md`; run focused vitest and
   `npm run check`.
