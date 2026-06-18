
# US-071: Paw CLI Reviewer Blocked Result Foundation

## Summary

Add `paw block-verifier <session-id> --decision-file <path>` as a bounded CLI foundation that reads
verify gate decision JSON, acquires the session lock, calls `blockPawVerifierResult`, and releases
an owned lock before returning.

## Scope

- Add `verifier-blocked-command.ts` with parser, result builder, formatting, and `runPawBlockReviewerCommand`.
- Route `paw block-verifier` through `handlePawCommand` before the normal agent runtime.
- Validate verify decision JSON before lock acquisition when project and session exist.
- Report structured outcomes including `blocked`, `invalid_decision_file`, `missing_decision_file`,
  `missing_project`, `missing_session`, `locked`, `invalid_state`, `no_selected_slice`,
  `invalid_blocked_decisions`, `invalid_blocked_decisions`, `invalid_blocked_reason`, `invalid_transition`,
  `not_locked`, and `locked_by_other`.
- Export block-verifier helpers from `packages/coding-agent/src/paw/index.ts`.
- Add focused tests and Harness story documentation.

## Acceptance Criteria

- `VERIFYING` sessions with blocked or `needs_user_decision` verify decision advance to matching
  `BLOCKED_*` states.
- Invalid or missing output files are reported without acquiring a session lock when project/session
  checks pass and output read/parse fails first.
- Owned locks acquired by the command are released for blocked, invalid_state, no_selected_slice,
  invalid_blocked_decisions, invalid_blocked_decisions, invalid_blocked_reason, invalid_transition, not_locked,
  and locked_by_other outcomes after acquire.
- Live foreign locks at acquire time are reported and not released.
- Help, missing session id, session ids beginning with `-`, missing/duplicate options, extra args,
  and unknown options set `exitCode = 1` without throwing.
- Focused tests listed in validation pass.
