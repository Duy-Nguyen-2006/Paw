# Design

## Domain Model

The slice introduces:

- Cost/latency/cache metrics for a high-risk task.
- Thresholds for USD, tokens, active-time seconds, and cache hit target.
- PASS/KILL result with evidence text and cache advisory status.

## Application Flow

Future live evaluation will run a high-risk task, collect measured cost,
latency, token, and cache metrics, and pass them to this evaluator. The
evaluator records whether S2 passes or must kill/redesign cost control.

## Interface Contract

The TypeScript foundation exports:

- Metric input, cache provider class, cache advisory, and result types.
- A deterministic evaluator helper.

## Data Model

Metrics include task class, USD, tokens, active-time seconds, provider class,
and optional cache hit rate.

## UI / Platform Impact

No user-facing CLI behavior changes in this slice.

## Observability

The result carries evidence text, path-level issues, and cache advisory details
so future benchmark reports can be recorded in the spike tracker.

## Alternatives Considered

1. Make cache hit rate a hard KILL condition.
   Rejected because SPEC §8.2 says cache support is advisory and local-provider
   paths are excluded.
2. Use raw wall-clock duration.
   Rejected because SPEC uses active machine time and excludes human wait.
