# Overview

## Current Behavior

Paw has durable `.paw/` initialization, validated session state persistence,
and session locks, but there is no core entry helper that combines those pieces
into a single task-session start or resume operation. Future runtime and CLI
slices would otherwise need to duplicate lock ordering, missing-state handling,
and first-state creation.

## Target Behavior

`startPawTaskSession` starts or resumes a Paw task session for a repository and
session id. It initializes `.paw/` from the runtime config, acquires the session
lock, and then returns one of three structured outcomes:

- `locked` when another live process owns the session lock, without writing
  `state.json`.
- `existing` when a valid `state.json` already exists, preserving that state.
- `started` when no state exists, creating an initial state transitioned to
  `INTAKE` and writing it atomically.

Malformed existing state is not treated as a missing session. It throws an
error that identifies the invalid state file.

## Affected Users

- Paw runtime implementers wiring future task execution.
- CLI implementers who need one core start/resume primitive before exposing
  task start or resume commands.
- Reviewers checking lock and persistence semantics without invoking provider
  or orchestrator behavior.

## Affected Product Docs

- `docs/product/paw-runtime.md`

## Non-Goals

- Adding or routing CLI commands.
- Editing `packages/coding-agent/src/main.ts`.
- Running the full Paw orchestrator loop.
- Implementing provider, scout, planner, worker, reviewer, or verifier
  execution.
- Implementing user-facing resume UX.
