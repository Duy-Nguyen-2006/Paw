# Overview

## Current Behavior

Paw has typed runtime config, sub-agent contracts, and a pure session state
model. It does not yet have a foundation for the `.paw/` directory layout from
`SPEC.md` section 12.

## Target Behavior

The Paw foundation can initialize a repository-local `.paw/` directory
idempotently with:

- `config.yaml`
- `version`
- `memory/memories.yaml`
- `rules/`
- `decisions/`
- ignored volatile directories and files
- a `.paw/.gitignore` matching the commit/ignore policy from
  `paw-spec/config.yaml`

The foundation also provides atomic JSON write/read helpers for future
`.paw/sessions/<id>/state.json` persistence.

## Affected Users

- Engineers and agents implementing future Paw CLI commands.
- Builders who will later run `paw init`.

## Affected Product Docs

- `docs/product/paw-runtime.md`

## Non-Goals

- Public `paw init` CLI wiring.
- Session locking and stale-lock recovery.
- Version migration.
- Shadow worktree checkpointing.
- Writing real session transcripts or artifacts.
