
# Design

## Domain Model

The slice introduces:

- Retention config view.
- Session and artifact retention records.
- Cleanup plan containing kept and removable records.

## Application Flow

Future `paw clean` code will scan `.paw/sessions` and `.paw/artifacts`, convert
paths into records, call this planner, show the plan, and then delete approved
paths in a separate runtime step.

## Interface Contract

The TypeScript foundation exports:

- Retention record and plan types.
- Retention cleanup planning helper.

## Data Model

Session records include id, path, and last activity timestamp. Artifact records
include name, path, and creation timestamp.

## UI / Platform Impact

No user-facing CLI behavior changes in this slice.

## Observability

The plan lists keep/delete decisions separately so future traces and reports can
explain cleanup behavior before deletion.

## Alternatives Considered

1. Delete files directly in this slice.
   Rejected because cleanup is destructive and needs a separate runtime command.
2. Use filesystem mtime directly in the helper.
   Rejected because pure records are easier to test and safer to reuse.
