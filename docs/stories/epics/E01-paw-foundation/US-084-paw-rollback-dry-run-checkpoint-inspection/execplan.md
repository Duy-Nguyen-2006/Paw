# Execution Plan

1. Add a rollback command parser requiring `--dry-run`.
2. Implement checkpoint/session metadata inspection without locks or writes.
3. Add formatter output with explicit no-mutation guarantees.
4. Route `paw rollback` through the Paw command dispatcher and barrel exports.
5. Add focused rollback command tests for parser, dry-run, missing/invalid cases, and CLI routing.
6. Validate with focused tests, Harness story verification, root check, diff check, and GitNexus change detection.
