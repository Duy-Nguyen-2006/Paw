# US-021: Paw SubAgentRuntime Foundation

## User Story

As Paw's orchestrator, I need a thin sub-agent runtime boundary so scout,
planner, worker, and reviewer calls can be validated consistently before real
provider execution is wired in.

## Source References

- `SPEC.md` §14 Sub-agent contract and sandbox fallback.
- `SPEC.md` §18 Architecture.
- `paw-spec/docs/decisions/ADR-01.md`.

## Scope

Implement a pure TypeScript runtime boundary that accepts a role/session/slice
invocation, enforces bounded handoff text, calls an injected executor, and
validates the raw JSON response through the existing sub-agent response
evaluator.

## Non-Goals

- No real provider or child process execution.
- No CLI command wiring.
- No sandbox implementation.
- No artifact file writes beyond carrying expected artifact refs.

## Acceptance Criteria

- Runtime inputs identify role, session id, optional slice id, artifact ref,
  handoff text, and retry attempt.
- Oversized handoffs block before executor invocation.
- Executor raw JSON is evaluated through the existing response fallback rules.
- Retry and blocked outcomes preserve validation issues and attempts.
- Public types and helper are exported from the Paw barrel.
