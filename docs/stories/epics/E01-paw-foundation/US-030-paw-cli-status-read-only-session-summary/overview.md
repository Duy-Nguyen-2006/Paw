
# Overview

## Current Behavior

Paw can initialize `.paw/` and report sandbox diagnostics, but there is no
bounded CLI command that summarizes whether a project is initialized or what
session state files are present. Users and agents must inspect `.paw/`
manually.

## Target Behavior

`pi paw status` performs a read-only status report and returns success even
when `.paw/` is missing. The report includes:

- `.paw` path.
- Initialized or not initialized state, with `pi paw init` suggested when
  missing.
- `.paw/config.yaml` parse status or a concise error summary.
- `.paw/version` value or missing/error status.
- Number of session directories under `.paw/sessions`.
- Counts by session state name for readable valid `state.json` files.
- Invalid or unreadable session count when present.

`pi paw status --help` prints help without reading config or writing project
files. Unknown `paw status` options set `process.exitCode = 1` and return
handled instead of throwing.

## Affected Users

- Paw implementers checking project initialization and persisted session state.
- Agents and reviewers validating read-only Paw CLI behavior before runtime
  orchestration exists.

## Affected Product Docs

- `docs/product/paw-runtime.md`

## Non-Goals

- Starting Paw orchestration, workers, reviewers, verifiers, or providers.
- Creating `.paw/`, locks, sessions, artifacts, or runtime files.
- Claiming full Paw CLI/runtime completion.
- Adding JSON output or standalone `paw` executable routing.
