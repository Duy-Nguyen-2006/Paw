
# Design

## Domain Model

The slice introduces:

- Final report input.
- Final report model.
- Terminal completion status.
- Markdown rendering helper.

## Application Flow

Future orchestrator code passes verification decisions, evidence, risks, and
degraded step records to the report helper after the slice loop finishes. The
helper determines whether the task is fully done or done with unverified gates.

## Interface Contract

The TypeScript foundation exports:

- Final report input and report types.
- Final report assembly helper.
- Final report markdown renderer.

## Data Model

The report keeps session id, summary, completion status, evidence strings,
risks, unverified gate records, degraded step records, and next actions.

## UI / Platform Impact

No user-facing CLI behavior changes in this slice.

## Observability

The report model is structured so future CLI, artifacts, and traces can render
or persist the same evidence without re-parsing markdown.

## Alternatives Considered

1. Render markdown directly from orchestrator state.
   Rejected because a typed model is easier to test and reuse.
2. Treat V2 or unconfigured gates as failures.
   Rejected because SPEC says unavailable gates are disclosed as unverified,
   while applicability is carried by the verification decision.
