# Execution Plan

1. Extend `subagent-runtime.ts` with provider completion adapter types and `createPawProviderSubAgentExecutor`.
2. Add fail-closed synthetic provider-unavailable output for missing model IDs and completion failures.
3. Export the new seam from the Paw barrel.
4. Add focused sub-agent runtime tests for accepted provider text, invalid JSON retry, provider failure, and missing model behavior.
5. Validate with focused runtime tests, Harness story verification, root check, diff check, and GitNexus change detection.
