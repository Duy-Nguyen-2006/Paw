# ADR-15: Liveness

- **Status:** Accepted
- **Date:** 2026-06-16
- **Deciders:** Tech Lead

## Context
Agents that hang, spin, or get killed mid-task destroy trust and waste spend.

## Decision
A **durable, resumable state machine**. **Every external call has timeout + retry + failover.**
**Loop caps** bound agent disagreement. The **liveness invariant**: every step must advance, enter a
`BLOCKED_*` state with a human-readable reason + suggested action, or escalate — **never silently
wait/spin/exit**.

## Consequences
- (+) The agent can always be resumed; stall_rate target = 0.
- (+) Provider outages become resumable BLOCKED states, not crashes.
- (-) Every step must be written to satisfy the invariant (enforced in the orchestrator + tests).

## Revisit trigger
None (foundational).

## Related
SPEC §8.7, §6.3; config.yaml: resilience.
