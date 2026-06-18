
# US-062: Paw CLI Plan Approval Foundation

## Summary

Add `paw approve-plan <session-id> --slice <slice-id>[:<title>]...` as a bounded
CLI foundation that acquires the session lock, calls `approvePawPlanSlices`, and
releases an owned lock before returning.

## Scope

- Add `plan-approval-command.ts` with parser, CLI slice builder, result builder,
  formatting, and `runPawApprovePlanCommand`.
- Route `paw approve-plan` through `handlePawCommand` before the normal agent runtime.
- Report structured outcomes including `advanced`, `missing_project`, `missing_session`,
  `locked`, `invalid_plan`, `invalid_transition`, `not_locked`, and `locked_by_other`.
- Export approve-plan helpers from `packages/coding-agent/src/paw/index.ts`.
- Add focused tests and Harness story documentation.

## Acceptance Criteria

- `PLAN_DRAFTED` sessions advance to `PLAN_APPROVED` with ordered `pending_slice_ids`
  derived from repeated `--slice` values in argument order.
- Slice values without a title use the slice id as title; `id:title` uses text after
  the first colon.
- Owned locks acquired by the command are released for advanced and invalid outcomes.
- Live foreign locks are reported and not released.
- Help, missing session id, session ids beginning with `-`, missing `--slice`, blank
  slice values, missing slice values, extra args, and unknown options set
  `exitCode = 1` without throwing.
- Focused tests listed in validation pass.
