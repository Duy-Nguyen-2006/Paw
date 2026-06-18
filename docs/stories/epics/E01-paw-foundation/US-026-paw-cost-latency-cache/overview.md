
# US-026: Paw S2 Cost Latency Cache Evaluator

## User Story

As Paw's efficiency engine, I need deterministic evaluation of high-risk task
cost, token, active-time, and cache metrics so S2 can be judged from measured
data without treating advisory cache data as a hard runtime gate.

## Source References

- `SPEC.md` §8.2 Provider prompt caching.
- `SPEC.md` §8.6 Budgets.
- `SPEC.md` §19 KPIs.
- `SPEC.md` §21 P0 spikes.
- `paw-spec/docs/decisions/ADR-10.md`.
- `paw-spec/docs/decisions/ADR-13.md`.
- `paw-spec/docs/decisions/PHASE0-SPIKE-TRACKER.md` S2.

## Scope

Add a pure TypeScript evaluator for injected high-risk task metrics. The
evaluator decides PASS or KILL against high-risk USD, token, and active-time
limits, and records hosted cache-hit advisory status.

## Non-Goals

- No live high-risk task execution.
- No provider API calls.
- No billing integration.
- No prompt cache implementation.

## Acceptance Criteria

- Passes when high-risk cost, tokens, and active time stay within configured
  limits.
- Kills when USD exceeds the high-risk cap.
- Kills when tokens exceed the high-risk cap.
- Kills when active time exceeds the high-risk SLA.
- Reports hosted cache hit rate as advisory pass/warn, not a hard KILL.
- Reports local provider cache as N/A.
- Records S2 spike evidence with live high-risk run limitations.
