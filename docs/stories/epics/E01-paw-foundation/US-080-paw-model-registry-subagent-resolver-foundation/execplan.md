
# Execution Plan

1. Add structural model-registry resolver types to Paw sub-agent runtime.
2. Implement `createPawModelRegistrySubAgentResolver` with provider/model parsing and auth option merging.
3. Export the resolver and types from the Paw barrel.
4. Extend focused runtime tests with fake registry success and failure cases.
5. Validate with focused tests, Harness story verification, root check, diff check, and GitNexus change detection.
