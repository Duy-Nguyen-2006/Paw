# Design

## Domain Model

The slice introduces:

- Artifact session name generation.
- Artifact path resolution by agent role.
- Markdown report write/read helpers.
- Artifact ref validation.

## Application Flow

Future sub-agent runtime code asks these helpers for a report path, writes the
report, and returns the relative `artifact_ref` in the validated sub-agent
output.

## Interface Contract

The TypeScript foundation exports:

- Artifact name generation.
- Artifact path resolution.
- Report write/read helpers.
- Artifact ref validation.

## Data Model

Reports are stored under `.paw/artifacts/<UTC>-<slug>-<shortid>/<agent>/report.md`.

## UI / Platform Impact

No user-facing CLI behavior changes in this slice.

## Observability

Invalid refs throw explicit errors with the offending value.

## Alternatives Considered

1. Use session id directly as artifact dir.
   Rejected because SPEC requires UTC timestamp, slug, and short id.
2. Let callers format artifact refs manually.
   Rejected because refs must match the sub-agent schema consistently.
