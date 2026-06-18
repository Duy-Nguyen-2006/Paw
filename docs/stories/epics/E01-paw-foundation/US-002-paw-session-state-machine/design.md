
# Design

## Domain Model

The slice introduces:

- `PawSessionStateName`: all non-blocked and blocked state names.
- `PawBlockedStateName`: blocked state names from the spec.
- `PawSessionState`: serializable state for one task/session.
- `PawStateTransition`: explicit transition event with optional slice/block
  context.

## Application Flow

The future orchestrator will construct an initial session state, advance it
through allowed transitions, mark slices complete, and enter blocked states
with a reason when a step cannot advance.

Transition helpers are pure. They do not read files, write files, call models,
or execute tools.

## Interface Contract

The TypeScript foundation under `packages/coding-agent/src/paw/` exports:

- A state schema and state types.
- `createInitialPawSessionState`.
- `transitionPawSessionState`.
- `isPawBlockedState`.
- `assertValidPawSessionState`.

Invalid transitions return validation-style issues instead of throwing by
default. This lets future command modes surface `BLOCKED_*` states cleanly.

## Data Model

No durable schema changes. The object is designed to be persisted as JSON in a
later `.paw/sessions/<id>/state.json` slice.

## UI / Platform Impact

No user-facing CLI or TUI behavior changes in this slice.

## Observability

Blocked transitions carry a code, message, and suggested action so future final
reports and traces can explain liveness failures.

## Alternatives Considered

1. Let the orchestrator own ad hoc string states.
   Rejected because SPEC §6.3 requires durable resumable state and explicit
   blocked states.
2. Implement persistence with the state model in one slice.
   Rejected to keep this slice small and testable before file-lock behavior.
