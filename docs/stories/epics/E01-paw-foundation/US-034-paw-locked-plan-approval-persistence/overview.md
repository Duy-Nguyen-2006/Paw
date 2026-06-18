
# Overview

## Current Behavior

Paw can validate ordered planner slice queues and can advance a persisted task
session through a supplied transition when the caller already owns the live
session lock. There is not yet a single core helper that composes those two
steps for plan approval.

Without that helper, future runtime callers would need to duplicate planner
slice validation, queue ordering, and `PLAN_APPROVED` transition construction
before persisting approved slices.

## Target Behavior

`approvePawPlanSlices` accepts a repository root, session id, planner slice
input, and optional lock options. It validates and sorts planner slices through
`createPawPlanSliceQueue` before any state write is attempted.

When planner slices are invalid, it returns `invalid_plan` with validation
issues and does not read or write session state. When planner slices are valid,
it delegates to `advancePawTaskSession` with a `PLAN_APPROVED` transition and
the ordered slice ids. The helper returns the ordered queue alongside the
structured transition result so future callers can inspect the exact approved
slice order.

## Affected Users

- Paw runtime implementers wiring future planner approval into locked session
  persistence.
- CLI implementers who will later route plan approval without duplicating core
  validation and transition logic.
- Reviewers validating plan approval persistence without provider-backed
  planner execution.

## Affected Product Docs

- `docs/product/paw-runtime.md`

## Non-Goals

- Adding or routing CLI commands.
- Editing `packages/coding-agent/src/main.ts`.
- Running a planner provider.
- Implementing the full multi-slice worker/reviewer/verifier loop.
- Acquiring, reclaiming, or removing locks in the approval helper.
