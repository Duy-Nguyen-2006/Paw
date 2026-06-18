
# US-067: Paw CLI Reviewer Pass Completion Foundation

## Summary

Add `paw complete-reviewer <session-id> --output-file <path>` as a bounded CLI
foundation that reads reviewer sub-agent output JSON, acquires the session lock, calls
`completePawReviewerPass`, and releases an owned lock before returning.

## Scope

- Add `reviewer-result-command.ts` with parser, result builder, formatting, and
  `runPawCompleteReviewerCommand`.
- Route `paw complete-reviewer` through `handlePawCommand` before the normal agent runtime.
- Validate output file with `parsePawSubAgentOutputJson` before lock acquisition when feasible.
- Report structured outcomes including `completed`, `invalid_output_file`, `missing_output_file`,
  `missing_project`, `missing_session`, `locked`, `invalid_state`, `no_selected_slice`,
  `invalid_reviewer_output`, `reviewer_not_passed`, `invalid_transition`, `not_locked`, and
  `locked_by_other`.
- Export complete-reviewer helpers from `packages/coding-agent/src/paw/index.ts`.
- Add focused tests and Harness story documentation.

## Acceptance Criteria

- `REVIEWING` sessions with valid reviewer pass output advance to `VERIFYING`.
- Invalid or missing output files are reported without acquiring a session lock when project/session
  checks pass and output read/parse fails first.
- Owned locks acquired by the command are released for completed, invalid_state, no_selected_slice,
  invalid_reviewer_output, reviewer_not_passed, invalid_transition, not_locked, and locked_by_other
  outcomes after acquire.
- Live foreign locks at acquire time are reported and not released.
- Help, missing session id, session ids beginning with `-`, missing/duplicate options, extra args, and
  unknown options set `exitCode = 1` without throwing.
- Focused tests listed in validation pass.
