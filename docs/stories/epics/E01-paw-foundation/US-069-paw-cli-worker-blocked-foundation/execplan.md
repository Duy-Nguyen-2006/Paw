
# Execution Plan

1. Implement `worker-blocked-command.ts` mirroring `worker-result-command.ts` lock-before-domain-call
   and release-after-outcome flow using `blockPawWorkerResult`.
2. Wire `handlePawCommand` and root `printPawHelp` in `init-command.ts`.
3. Export public types and functions from `index.ts`.
4. Add `paw-worker-blocked-command.test.ts` with parser, integration, routing, and `main` coverage.
5. Update `docs/TEST_MATRIX.md` and story `validation.md`; run focused vitest and `npm run check`.
