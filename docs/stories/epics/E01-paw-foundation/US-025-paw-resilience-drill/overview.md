# US-025: Paw S5 Provider Resilience Drill Evaluator

## User Story

As Paw's orchestrator, I need deterministic resilience drill evaluation so a
provider-kill scenario proves retry, failover, degraded reporting, resume, and
no data-loss evidence before the spike can pass.

## Source References

- `SPEC.md` §8.7 Liveness invariant.
- `SPEC.md` §9.4 Provider failover honesty.
- `SPEC.md` §21 P0 spikes.
- `paw-spec/docs/decisions/ADR-15.md`.
- `paw-spec/docs/decisions/PHASE0-SPIKE-TRACKER.md` S5.

## Scope

Add a pure TypeScript evaluator for injected resilience drill events. The
evaluator decides PASS or KILL from simulated provider failure, retry/failover,
resume completion, degraded flag, and no-data-loss markers.

## Non-Goals

- No live provider calls.
- No network chaos tooling.
- No orchestrator event loop wiring.
- No persistent session replay implementation.

## Acceptance Criteria

- Passes when provider failure is followed by retry/failover, degraded marking,
  resume completion, and no-data-loss evidence.
- Kills when failover is missing after provider kill.
- Kills when degraded is not surfaced.
- Kills when resume does not complete.
- Kills when data loss is reported.
- Records S5 spike evidence with live provider-chaos limitations.
