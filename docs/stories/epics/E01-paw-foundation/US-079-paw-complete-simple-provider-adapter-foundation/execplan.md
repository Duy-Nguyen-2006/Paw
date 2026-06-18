
# Execution Plan

1. Add `completeSimple`-style adapter types to Paw sub-agent runtime.
2. Implement `createPawCompleteSimpleSubAgentCompletion` with injected resolver and completer.
3. Export the adapter and supporting types from the Paw barrel.
4. Extend focused runtime tests with fake resolver/completer coverage.
5. Validate with focused tests, Harness story verification, root check, diff check, and GitNexus change detection.
