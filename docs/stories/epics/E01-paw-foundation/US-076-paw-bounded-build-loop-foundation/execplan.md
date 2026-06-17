# Execution Plan

1. Extend parser tests for `--max-steps` acceptance and validation failures.
2. Add loop result types and a bounded loop wrapper around the existing one-step build implementation.
3. Add loop formatting for steps run, max steps, stop reason, and final state.
4. Add focused integration tests for max-step stop, no-pending completion, and provider-unavailable stop.
5. Validate with focused tests, Harness story verification, root check, diff check, and GitNexus change detection.
