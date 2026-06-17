# US-074: Paw Build Verifier Orchestration Foundation

## Summary

Extend `paw build <session-id> --once` so it can run exactly one verifier step for an existing `VERIFYING` session by reusing the existing non-native `paw verify` command path.

## Scope

- Dispatch `VERIFYING` sessions from `paw build <session-id> --once` to `createPawVerifyCommandResult`.
- Keep `paw build` verifier execution non-native by default, with no subprocess executor unless a future slice wires that explicitly.
- Persist verifier completion through existing verification helpers, including `verification-evidence.json` as an empty evidence list for non-native verification.
- Extend build formatting to render verifier gate summaries and lock-release status.
- Preserve existing worker and reviewer orchestration behavior.

## Acceptance Criteria

- `VERIFYING` sessions with selected slices advance to `SLICE_DONE` through `paw build <session-id> --once`.
- Default verifier build execution returns `completed_with_unverified` when gates cannot run natively.
- Non-native verifier build writes `verification-evidence.json` as `[]` and reports `native executed gates: none`.
- Missing project/session, invalid state, and live foreign locks remain structured outcomes without unsafe lock release.
- Existing `IMPLEMENTING` worker and `REVIEWING` reviewer build behavior remains covered and passing.
