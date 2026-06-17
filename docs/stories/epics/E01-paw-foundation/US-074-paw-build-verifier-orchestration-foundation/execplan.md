# Execution Plan

1. Add focused tests proving `VERIFYING -> SLICE_DONE` through `paw build <session-id> --once`, non-native evidence persistence, and formatter output.
2. Extend build command dispatch so `VERIFYING` sessions call the existing verify command result creator with lock options only.
3. Extend build command formatting for verifier completed and unverified outcomes.
4. Preserve worker and reviewer regression coverage in the existing focused build command test suite.
5. Validate with focused tests, Harness story verification, root check, whitespace diff check, and GitNexus change detection.
