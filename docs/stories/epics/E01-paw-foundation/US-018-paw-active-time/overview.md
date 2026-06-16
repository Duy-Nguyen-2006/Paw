# US-018: Paw Active-Time Clock Policy

## User Story

As Paw's SLA tracker, I need active machine-time accounting so human approval
waits do not count against task latency.

## Source References

- `SPEC.md` §8.7 Liveness invariant.
- `SPEC.md` §19 KPIs.
- `paw-spec/config.yaml` `resilience.active_time_clock`.

## Scope

Implement a pure TypeScript helper that totals elapsed time across state
segments and excludes configured pause states when active-time accounting is
enabled.

## Non-Goals

- No orchestrator wiring.
- No SLA enforcement.
- No wall-clock sampling process.
- No persistence.

## Acceptance Criteria

- Active time excludes `BLOCKED_NEEDS_USER_DECISION` by default config.
- Disabled active-time clock counts all elapsed time as active.
- Open segments can be closed with an explicit `now` timestamp.
- Invalid or negative segments are rejected with path-level issues.
- Output includes active, paused, and total milliseconds.
