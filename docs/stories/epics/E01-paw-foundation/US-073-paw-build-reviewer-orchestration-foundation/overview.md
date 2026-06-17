# US-073: Paw Build Reviewer Orchestration Foundation

## Summary

Extend `paw build <session-id> --once` so it can run exactly one reviewer sub-agent runtime step for an existing
`REVIEWING` session and persist the reviewer result through existing reviewer pass or blocked transition helpers.

## Scope

- Add reviewer orchestration logic that acquires a session lock, validates `REVIEWING` state and selected slice,
  invokes `runPawSubAgentRuntime`, and releases owned locks.
- Retry invalid reviewer JSON once before converting exhausted invalid output into `BLOCKED_CONTEXT_MISSING`.
- Persist `pass` reviewer outputs through `completePawReviewerPass` and blocked or `needs_user_decision` outputs through
  `blockPawReviewerResult`.
- Extend `paw build <session-id> --once` to dispatch to reviewer orchestration for `REVIEWING` sessions while preserving
  the existing worker orchestration for `IMPLEMENTING` sessions.
- Keep the default CLI executor fail-closed as `BLOCKED_PROVIDER_UNAVAILABLE` until real provider execution is wired.
- Export reviewer orchestration helpers from `packages/coding-agent/src/paw/index.ts`.

## Acceptance Criteria

- `REVIEWING` sessions with selected slices and injected `pass` reviewer output advance to `VERIFYING`.
- Injected blocked reviewer output advances to the matching `BLOCKED_*` state and stores blocked reason metadata.
- Invalid reviewer JSON retries once; a valid second attempt completes, while two invalid attempts become `BLOCKED_CONTEXT_MISSING`.
- Missing project/session, invalid source state, and missing selected slice report structured outcomes without mutation.
- Live foreign locks at acquire time are reported and not released.
- Existing `IMPLEMENTING` worker build behavior remains covered and passing.
- Default CLI execution without a wired provider blocks as `BLOCKED_PROVIDER_UNAVAILABLE` for both worker and reviewer states.
