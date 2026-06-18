
# Execution Plan

1. Extend `PawBuildCommandInput` with an optional `providerExecutor` field.
2. Resolve build sub-agent execution through a single helper that enforces mutual exclusivity.
3. Use `createPawProviderSubAgentRuntimeExecutor` only when `providerExecutor` is explicitly provided.
4. Add fake-safe build tests for worker, reviewer, resolver failure, default fail-closed behavior, and ambiguous input rejection.
5. Validate with focused tests, Harness story verification, root check, diff check, and GitNexus change detection.
