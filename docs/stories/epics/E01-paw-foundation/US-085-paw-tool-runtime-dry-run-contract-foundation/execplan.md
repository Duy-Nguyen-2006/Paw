
# Execution Plan

1. Add tool runtime request and decision types.
2. Implement a pure dry-run evaluator using existing approval, sandbox, secret, and injection policies.
3. Export the evaluator and types from the Paw barrel with additive-only exports.
4. Add focused tests for allow, approval block, sandbox block, secret path block, untrusted source block, and invalid request cases.
5. Validate with focused tests, Harness story verification, root check, diff check, and GitNexus change detection.
