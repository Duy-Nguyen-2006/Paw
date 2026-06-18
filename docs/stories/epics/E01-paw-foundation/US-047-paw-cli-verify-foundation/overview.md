
# US-047: Paw CLI Verify Foundation

## Summary

Add `paw verify <session-id>` as a bounded verification foundation command. The
command requires an existing `VERIFYING` session, acquires the session lock,
records configured v1 verification gates as explicitly unverified, advances the
slice to `SLICE_DONE`, and releases the lock before exiting.

## Scope

- Add a verify command module for existing Paw sessions.
- Route `paw verify <session-id>` through the Paw command dispatcher before the
  normal agent runtime.
- Generate `PawVerifyGateDecision` entries from `paw-spec/config.yaml` v1 gates.
- Disclose that gate command execution is not wired yet instead of claiming
  verification passed.
- Persist verifier result through `completePawVerification` under the acquired
  session lock.
- Export the verify command helpers for package consumers and tests.

## Acceptance Criteria

- Existing `VERIFYING` session state advances to `SLICE_DONE`.
- Configured gates are recorded as `unverified` with explicit reasons.
- The command acquires and releases the current session lock.
- Live locks owned by another host/pid are reported without being released.
- Missing `.paw` and missing session state do not create session state files.
- Wrong session state does not mutate the state file.
- Focused tests, Harness story verification, and root `npm run check` pass.
