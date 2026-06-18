
# Overview

## Current Behavior

Paw has a pure retention planner, but there is no CLI command that shows what
would be kept or removed from `.paw/sessions/` and `.paw/artifacts/`. Users and
agents must inspect runtime paths manually, and destructive cleanup is not yet
implemented.

## Target Behavior

`pi paw clean --dry-run` performs a read-only retention scan and prints a
concise plan. The report includes:

- `.paw` path.
- Retention defaults loaded from `paw-spec/config.yaml`.
- Session and artifact candidate counts.
- Kept and removable sessions.
- Kept and removable artifacts.
- Removal reasons from the existing retention policy.
- A clear statement that no files were deleted.

`pi paw clean` without `--dry-run` rejects the command, sets
`process.exitCode = 1`, and does not delete anything.

`pi paw clean --help` prints help without reading `.paw/` or creating project
files.

## Affected Users

- Paw implementers validating retention behavior before destructive cleanup is
  designed.
- Agents and reviewers checking `.paw/` growth without mutating runtime state.

## Affected Product Docs

- `docs/product/paw-runtime.md`
- `docs/stories/epics/E01-paw-foundation/US-020-paw-retention-policy/design.md`

## Non-Goals

- Deleting files or directories.
- Adding approval semantics for destructive cleanup.
- Editing `packages/coding-agent/src/main.ts`.
- Starting Paw orchestration, workers, reviewers, verifiers, or providers.
- JSON output.
