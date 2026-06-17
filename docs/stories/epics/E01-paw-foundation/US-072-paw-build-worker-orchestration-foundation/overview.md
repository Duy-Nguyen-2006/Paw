# US-072: Paw Build Worker Orchestration Foundation

## Summary

Add `paw build <session-id> --once` as the first bounded orchestration command. It runs exactly one worker
sub-agent runtime step for an existing `IMPLEMENTING` session and persists the worker result through existing
worker pass or blocked transition helpers.

## Scope

- Add worker orchestration logic that acquires a session lock, validates `IMPLEMENTING` state and selected slice,
  invokes `runPawSubAgentRuntime`, and releases owned locks.
- Retry invalid worker JSON once before converting exhausted invalid output into `BLOCKED_CONTEXT_MISSING`.
- Persist `pass` worker outputs through `completePawWorkerPass` and blocked or `needs_user_decision` outputs through
  `blockPawWorkerResult`.
- Add `paw build <session-id> --once` parser, formatter, command runner, help text, and `handlePawCommand` routing.
- Keep the default CLI executor fail-closed as `BLOCKED_PROVIDER_UNAVAILABLE` until real provider execution is wired.
- Export build and worker orchestration helpers from `packages/coding-agent/src/paw/index.ts`.

## Acceptance Criteria

- `IMPLEMENTING` sessions with selected slices and injected `pass` worker output advance to `REVIEWING` with journal entries.
- Injected blocked worker output advances to the matching `BLOCKED_*` state and stores blocked reason metadata.
- Invalid worker JSON retries once; a valid second attempt completes, while two invalid attempts become `BLOCKED_CONTEXT_MISSING`.
- Missing project/session, invalid source state, and missing selected slice report structured outcomes without mutation.
- Live foreign locks at acquire time are reported and not released.
- Default CLI execution without a wired provider blocks as `BLOCKED_PROVIDER_UNAVAILABLE` rather than silently succeeding.
- `handlePawCommand` and `main` route `paw build` before normal agent runtime.
