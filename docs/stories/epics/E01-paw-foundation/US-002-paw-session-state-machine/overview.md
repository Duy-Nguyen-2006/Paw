
# Overview

## Current Behavior

`US-001` added Paw runtime config and sub-agent output contract validation, but
there is no typed representation of the Paw task/session state machine from
`SPEC.md` section 6.3.

## Target Behavior

The Paw foundation exposes a pure, serializable session state model that
captures:

- The accepted active states and blocked states.
- Current slice identity.
- Completed slice identities.
- Transition validation for the v1 flow.
- Resumable blocked states with human-readable reason and suggested action.

## Affected Users

- Engineers and agents implementing the future Paw orchestrator.
- Builders who will later rely on resume behavior after blocked or interrupted
  sessions.

## Affected Product Docs

- `docs/product/paw-runtime.md`

## Non-Goals

- CLI command wiring.
- File persistence under `.paw/sessions`.
- Real worker/reviewer/verifier execution.
- Crash recovery or provider failover implementation.
