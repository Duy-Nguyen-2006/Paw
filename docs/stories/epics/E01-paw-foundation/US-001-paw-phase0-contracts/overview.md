# Overview

## Current Behavior

The repository contains the accepted Paw v0.4 build spec in `SPEC.md` and a
supporting `paw-spec/` bundle with all 21 ADRs, default runtime config, a
sub-agent JSON schema, and a Phase 0 spike tracker. The harness product docs
and story matrix do not yet describe Paw, and no Paw foundation implementation
exists in `packages/coding-agent`.

## Target Behavior

The Paw v1 product contract is represented as living product docs, the accepted
Paw ADRs are registered as durable decisions, and the first implementation slice
creates the foundation contracts needed before orchestration work:

- Runtime config loading from `paw-spec/config.yaml`.
- Sub-agent output validation against the canonical contract shape.
- A typed foundation surface that later CLI and orchestrator slices can import.

## Affected Users

- Builders running the future `paw` CLI.
- Engineers and agents implementing Paw slices.

## Affected Product Docs

- `docs/product/paw-overview.md`
- `docs/product/paw-runtime.md`
- `docs/product/paw-security.md`

## Non-Goals

- Full Paw CLI command implementation.
- Provider calls or model routing execution.
- Sandbox execution.
- Shadow worktree checkpointing.
- Multi-repo evaluation harness.
- Marking Phase 0 spikes passed without evidence.
