
# Overview

## Current Behavior

Paw persistence can initialize durable `.paw/` defaults through
`initializePawProject`, but the Pi CLI does not expose a bounded Paw init route.
Running `pi paw init` would fall through to the normal agent runtime as a prompt
instead of initializing Paw project files.

## Target Behavior

`pi paw init` initializes durable Paw project files under `.paw/` without
starting the normal agent runtime. The command loads `paw-spec/config.yaml`
through the existing config loader, calls the existing persistence helper, and
prints concise counts for created and existing paths.

`pi paw init --help` shows command help without creating files. Unknown Paw
subcommands and invalid `paw init` options report CLI misuse with
`process.exitCode = 1` instead of throwing.

## Affected Users

- Paw implementers preparing a repository for future Paw runtime work.
- Agents and reviewers validating the P1 CLI entry slice.

## Affected Product Docs

- `docs/product/paw-overview.md`
- `docs/product/paw-runtime.md`

## Non-Goals

- Wiring a standalone `paw` binary.
- Implementing the full Paw CLI command set.
- Starting Paw orchestration, sessions, workers, reviewers, or verifiers.
- Changing `.paw` persistence semantics beyond exposing the existing init
  helper through `pi paw init`.
