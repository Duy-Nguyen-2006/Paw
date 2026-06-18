
# Execution Plan

1. Add composed provider executor input type.
2. Implement `createPawProviderSubAgentRuntimeExecutor` by composing existing resolver, completion adapter, and executor seam.
3. Export the composed factory and input type from the Paw barrel.
4. Add fake-safe runtime tests for successful composition and fail-closed paths.
5. Validate with focused tests, Harness story verification, root check, diff check, and GitNexus change detection.
