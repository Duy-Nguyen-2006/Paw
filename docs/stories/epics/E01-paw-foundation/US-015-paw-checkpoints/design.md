# Design

## Domain Model

The slice introduces:

- Checkpoint name generation.
- Checkpoint path resolution.
- Checkpoint metadata validation.
- Atomic metadata write/read helpers.

## Application Flow

Future orchestrator code creates a per-slice checkpoint before R1+ writes,
stores metadata under `.paw/checkpoints/`, then uses that metadata when rollback
support is added.

## Interface Contract

The TypeScript foundation exports:

- Checkpoint name generation.
- Checkpoint path resolution.
- Checkpoint metadata write/read helpers.
- Checkpoint metadata validation.

## Data Model

Checkpoint metadata is stored at
`.paw/checkpoints/<sessionId>/<checkpointName>/checkpoint.json`.

## UI / Platform Impact

No user-facing CLI behavior changes in this slice.

## Observability

Invalid checkpoint names and malformed metadata return explicit validation
errors with path information.

## Alternatives Considered

1. Create the shadow worktree in this slice.
   Rejected because this story is a persistence contract foundation; actual git
   snapshotting needs separate safety review.
2. Put checkpoint metadata in the session journal.
   Rejected because rollback data needs its own durable path and future artifact
   references.
