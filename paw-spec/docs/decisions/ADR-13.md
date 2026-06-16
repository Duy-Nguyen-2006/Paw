# ADR-13: Context discipline

- **Status:** Accepted
- **Date:** 2026-06-16
- **Deciders:** Tech Lead, BE1

## Context
Model accuracy degrades with long, noisy context ("lost in the middle"). Blind truncation hurts
quality; dumping everything hurts both cost and quality.

## Decision
Working context is **adaptive-capped per model and per class** (not a flat global constant). Prefer
**precision retrieval** (ranked `file:line` spans + read-on-demand) over dumping. Use provider
prompt-caching when available, but treat cache-hit as an **advisory metric, never a CI gate**.
A **recall guard** escalates (with a drilldown pointer) rather than silently dropping spans the
planner marked required.

## Consequences
- (+) Cheaper AND smarter at the same time.
- (+) No CI coupling to provider billing behavior; local models excluded from cache KPI.
- (-) Retrieval/ranking and the recall guard add engine complexity.

## Revisit trigger
Provider caching becomes unavailable, or retrieval quality regresses.

## Related
SPEC §8.1, §8.2, §15; config.yaml: context, prompt_cache.
