
# Execution Plan

1. Add a sub-agent sandbox preflight helper around existing sandbox policy evaluation.
2. Thread optional preflight input through worker and reviewer orchestrators.
3. Thread optional preflight input through `PawBuildCommandInput`.
4. Add fake-safe build tests for worker block, reviewer block, allow path, and default behavior preservation.
5. Validate with focused tests, Harness story verification, root check, diff check, and GitNexus change detection.
