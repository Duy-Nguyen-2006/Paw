
# US-024: Paw S4 Scout Large-Repo Benchmark Evaluator

## User Story

As Paw's scout planner, I need deterministic benchmark evaluation for
`ripgrep`, `ctags`, and `git` scout metrics so large-repo feasibility can be
judged from measured data instead of guesses.

## Source References

- `SPEC.md` §8.1 Token frugality.
- `SPEC.md` §21 P0 spikes.
- `paw-spec/docs/decisions/ADR-11.md`.
- `paw-spec/docs/decisions/PHASE0-SPIKE-TRACKER.md` S4.

## Scope

Add a pure TypeScript evaluator for injected scout benchmark metrics. The
evaluator decides PASS or KILL against repo size, active-time, token, and cache
thresholds and produces evidence text for S4.

## Non-Goals

- No live 100k-file benchmark execution.
- No shelling out to `rg`, `ctags`, or `git`.
- No scout implementation or caching runtime.
- No graph or embeddings work.

## Acceptance Criteria

- Accepts measured file count, command timings, token usage, and cache hit data.
- Passes when the sample reaches at least 100k files and stays within configured
  limits.
- Kills when repo size is too small, timings exceed the SLA, tokens exceed the
  budget, or cache hit rate is below threshold.
- Produces evidence text naming `ripgrep`, `ctags`, and `git` measurements.
- Records S4 spike evidence with live benchmark execution limitations.
