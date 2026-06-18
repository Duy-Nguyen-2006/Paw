
# US-009: Paw Resilience And Liveness Policy

## User Story

As Paw's orchestrator, I need config-backed resilience policy helpers so every
external call advances, retries/fails over, blocks, or reports unverified
instead of silently waiting or crashing.

## Source References

- `SPEC.md` §8.7 Liveness invariant.
- `SPEC.md` §9.1 Degradeable gates.
- `SPEC.md` §9.4 Provider failover honesty.
- `paw-spec/config.yaml` `resilience` and `verify` sections.

## Scope

Implement pure TypeScript helpers that evaluate retry/failover decisions,
sub-agent timeout decisions, loop-cap decisions, and degradeable verification
gate decisions.

## Non-Goals

- No provider calls.
- No subprocess watchdog implementation.
- No CLI status rendering.
- No report generation.

## Acceptance Criteria

- LLM retry/failover decisions use configured retry count and
  `on_5xx_or_429` behavior.
- Provider failover to a lower tier marks the affected step as degraded.
- Tool and sub-agent timeouts return blocked decisions with suggested actions.
- Loop-cap exhaustion returns an escalation/fail-closed style decision.
- Unrunnable verification gates return unverified records instead of false
  success.
