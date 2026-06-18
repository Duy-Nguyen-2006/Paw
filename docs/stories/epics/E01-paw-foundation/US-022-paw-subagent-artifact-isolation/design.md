
# Design

## Domain Model

The slice introduces:

- Bounded sub-agent artifact report input.
- Artifact isolation result containing canonical paths, artifact ref, byte
  count, and max bytes.
- Artifact isolation failure with path-level validation issues.

## Application Flow

Future sub-agent execution will write detailed role output through this helper,
then return only the bounded machine summary and `artifact_ref` to the parent
orchestrator. Oversized report content blocks before filesystem writes.

## Interface Contract

The TypeScript foundation exports:

- Artifact isolation input and result types.
- A bounded report writer that composes with existing artifact path helpers.

## Data Model

Artifact isolation uses existing artifact names, roles, and report refs. It adds
a max byte limit to prevent unbounded reports from entering `.paw/artifacts`.

## UI / Platform Impact

No user-facing CLI behavior changes in this slice.

## Observability

The result records the final byte count and max byte limit so future traces can
explain why a report was written or rejected.

## Alternatives Considered

1. Let sub-agent executors write artifact files directly.
   Rejected because it bypasses canonical path and size enforcement.
2. Truncate oversized artifact reports silently.
   Rejected because S1 requires reliable bounded isolation, not silent data loss.
