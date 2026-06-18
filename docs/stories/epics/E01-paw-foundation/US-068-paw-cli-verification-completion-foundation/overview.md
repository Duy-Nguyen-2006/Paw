
# US-068: Paw CLI Verification Completion Foundation

## Summary

Add `paw complete-verification <session-id> --decision-file <path>` as a bounded CLI
foundation that reads verify gate decision JSON, acquires the session lock, calls
`completePawVerification`, and releases an owned lock before returning.

## Scope

- Add `verifier-result-command.ts` with parser, result builder, formatting, and
  `runPawCompleteVerificationCommand`.
- Route `paw complete-verification` through `handlePawCommand` before the normal agent runtime.
- Validate decision file JSON before lock acquisition when feasible.
- Accept either a `PawVerifyGateDecision[]` array or `{ verify_decisions: [...] }`.
- Report structured outcomes including `completed`, `completed_with_unverified`,
  `invalid_decision_file`, `missing_decision_file`, `missing_project`, `missing_session`,
  `locked`, `invalid_state`, `no_selected_slice`, `invalid_verify_decisions`,
  `invalid_transition`, `not_locked`, and `locked_by_other`.
- Export complete-verification helpers from `packages/coding-agent/src/paw/index.ts`.
- Add focused tests and Harness story documentation.

## Acceptance Criteria

- `VERIFYING` sessions with valid verify decisions advance to `SLICE_DONE`.
- Invalid or missing decision files are reported without acquiring a session lock when project/session
  checks pass and decision read/parse fails first.
- Owned locks acquired by the command are released for completed, completed_with_unverified,
  invalid_state, no_selected_slice, invalid_verify_decisions, invalid_transition, not_locked, and
  locked_by_other outcomes after acquire.
- Live foreign locks at acquire time are reported and not released.
- Help, missing session id, session ids beginning with `-`, missing/duplicate options, extra args, and
  unknown options set `exitCode = 1` without throwing.
- Focused tests listed in validation pass.
