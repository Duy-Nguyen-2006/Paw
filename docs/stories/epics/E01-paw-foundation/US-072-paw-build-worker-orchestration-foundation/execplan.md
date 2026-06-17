# Execution Plan

1. Add focused tests for `paw build <session-id> --once` parser, worker pass, blocked output, retry, invalid state, locks, default fail-closed executor, and routing.
2. Add a worker orchestration helper that composes existing session lock, sub-agent runtime, worker pass, and worker blocked helpers.
3. Add the build command wrapper and route it through `handlePawCommand`.
4. Export new helpers from the Paw public barrel.
5. Run focused tests, Harness story verification, `./test.sh`, and `npm run check`.
