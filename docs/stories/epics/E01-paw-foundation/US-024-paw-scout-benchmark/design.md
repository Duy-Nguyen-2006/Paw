# Design

## Domain Model

The slice introduces:

- Scout benchmark input.
- Per-tool timing measurements.
- Thresholds for repo size, active time, token budget, and cache hit rate.
- PASS/KILL result with path-level issues and evidence text.

## Application Flow

Future benchmark tooling will run `ripgrep`, `ctags`, and `git` on a large repo,
then pass the measured metrics to this evaluator. The evaluator records whether
S4 passes or must kill/redesign the scout approach.

## Interface Contract

The TypeScript foundation exports:

- Benchmark input, thresholds, and result types.
- A deterministic evaluator helper.

## Data Model

Measurements include command name, duration, and optional notes. Aggregate input
includes file count, token count, active-time seconds, and hosted cache hit rate.

## UI / Platform Impact

No user-facing CLI behavior changes in this slice.

## Observability

The result carries evidence text and failure issues so future benchmark reports
can be pasted into the spike tracker.

## Alternatives Considered

1. Mark S4 complete without metric thresholds.
   Rejected because performance work needs measured data.
2. Run a synthetic fake large repo in this slice.
   Rejected because it would measure local filesystem generation overhead more
   than scout behavior.
