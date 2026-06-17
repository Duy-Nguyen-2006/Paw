# Design

## Command

`paw build <session-id> --once` now reads session state before dispatch and chooses the smallest existing command helper for the current phase:

- `PLAN_APPROVED` or `SLICE_DONE` uses `createPawSelectSliceCommandResult`.
- `SLICE_SELECT` uses `createPawBeginImplementationCommandResult`.
- `IMPLEMENTING` continues to use worker orchestration.
- `REVIEWING` continues to use reviewer orchestration.
- `VERIFYING` continues to use verifier orchestration.

## Result Formatting

Build formatting renders coordinator `advanced` and `no_pending_slices` outcomes with session, status, selected slice when present, state transition, and lock-release status.

## Out Of Scope

- Full automatic multi-step loop.
- Final report emission from `paw build`.
- Real provider execution and sandbox/tool runtime wiring.
