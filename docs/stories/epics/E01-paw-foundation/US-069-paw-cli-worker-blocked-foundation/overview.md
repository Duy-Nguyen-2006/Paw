# US-069: Paw CLI Worker Blocked Result Foundation

## Summary

Add `paw block-worker <session-id> --output-file <path>` as a bounded CLI foundation that reads
worker sub-agent output JSON, acquires the session lock, calls `blockPawWorkerResult`, and releases
an owned lock before returning.

## Scope

- Add `worker-blocked-command.ts` with parser, result builder, formatting, and `runPawBlockWorkerCommand`.
- Route `paw block-worker` through `handlePawCommand` before the normal agent runtime.
- Validate worker output JSON before lock acquisition when project and session exist.
- Report structured outcomes including `blocked`, `invalid_output_file`, `missing_output_file`,
  `missing_project`, `missing_session`, `locked`, `invalid_state`, `no_selected_slice`,
  `invalid_worker_output`, `worker_not_blocked`, `invalid_blocked_reason`, `invalid_transition`,
  `not_locked`, and `locked_by_other`.
- Export block-worker helpers from `packages/coding-agent/src/paw/index.ts`.
- Add focused tests and Harness story documentation.

## Acceptance Criteria

- `IMPLEMENTING` sessions with blocked or `needs_user_decision` worker output advance to matching
  `BLOCKED_*` states.
- Invalid or missing output files are reported without acquiring a session lock when project/session
  checks pass and output read/parse fails first.
- Owned locks acquired by the command are released for blocked, invalid_state, no_selected_slice,
  invalid_worker_output, worker_not_blocked, invalid_blocked_reason, invalid_transition, not_locked,
  and locked_by_other outcomes after acquire.
- Live foreign locks at acquire time are reported and not released.
- Help, missing session id, session ids beginning with `-`, missing/duplicate options, extra args,
  and unknown options set `exitCode = 1` without throwing.
- Focused tests listed in validation pass.
