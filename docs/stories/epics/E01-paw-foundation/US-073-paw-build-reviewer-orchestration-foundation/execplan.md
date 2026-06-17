# Execution Plan

1. Add focused tests for `paw build <session-id> --once` reviewer pass, reviewer blocked, invalid JSON retry, invalid JSON exhaustion, default fail-closed executor, and existing worker path regression coverage.
2. Add a reviewer orchestration helper that composes existing session lock, sub-agent runtime, reviewer pass, and reviewer blocked helpers.
3. Extend `build-command.ts` to dispatch `REVIEWING` sessions to reviewer orchestration and keep `IMPLEMENTING` sessions on worker orchestration.
4. Export reviewer orchestration helpers from the Paw public barrel.
5. Run focused tests, Harness story verification, `npm run check`, and inspect changes.
