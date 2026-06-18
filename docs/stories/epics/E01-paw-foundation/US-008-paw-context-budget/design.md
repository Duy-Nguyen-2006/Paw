
# Design

## Domain Model

The slice introduces:

- Context limit lookup by task class and sub-agent role.
- File and tool-output inclusion decisions.
- Handoff budget decisions for required and optional spans.
- Context assembly order projection from config.

## Application Flow

Future scout/planner/worker/reviewer wiring asks these helpers before placing
content into model context. The helpers return structured decisions:
`include`, `summarize`, `metadata_only`, `truncate`, or `escalate`.

## Interface Contract

The TypeScript foundation exports:

- Context cap lookup helpers.
- File-read and tool-output budget evaluation.
- Handoff span budget evaluation.
- Stable-first context assembly order from runtime config.

## Data Model

No filesystem or database changes.

## UI / Platform Impact

No user-facing CLI behavior changes in this slice.

## Observability

Escalation decisions include a message and suggested action for later reports.

## Alternatives Considered

1. Hardcode context caps.
   Rejected because SPEC and existing runtime docs require config-backed caps.
2. Truncate required spans automatically.
   Rejected because SPEC requires required-span recall and drill-down instead of
   silent truncation.
