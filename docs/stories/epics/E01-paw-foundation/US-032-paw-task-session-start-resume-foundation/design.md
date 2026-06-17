# Design

## Domain Model

US-032 adds a small application-level helper over existing Paw persistence and
lock primitives:

- Input: repository root, session id, optional runtime config, and optional
  session lock options.
- Output: a discriminated result with `started`, `existing`, or `locked`
  status.
- Started/existing results include the acquired lock, any reclaimed stale lock
  metadata, initialization result, and session state.
- Locked results include the live lock metadata and initialization result, but
  no state.

The helper does not add a new durable schema.

## Application Flow

The helper flow is:

1. Resolve the runtime config from the supplied input or
   `paw-spec/config.yaml`.
2. Call `initializePawProject` so durable `.paw/` defaults exist without
   overwriting existing files.
3. Call `acquirePawSessionLock` for `.paw/sessions/<id>/session.lock`.
4. If acquisition reports a live lock, return `locked` immediately and do not
   read or write `state.json`.
5. Read existing session state.
6. If `state.json` is missing, create an initial session state, transition it
   from `IDLE` to `INTAKE`, and persist it through `writePawSessionState`.
7. If `state.json` exists and validates, return `existing` with the persisted
   state.
8. If existing state is malformed or invalid, throw an error identifying the
   state file.

## Safety Boundaries

The helper preserves lock ordering: no session state is read or written unless
the current process owns the session lock. Missing state is the only expected
read failure that becomes a start operation. Validation and parse failures
remain surfaced as errors.

Stale locks are reclaimed by the existing lock helper only when the owning
process is dead or the heartbeat exceeds the configured TTL.

## Alternatives Considered

1. Treat malformed state as missing and overwrite it.
   - Rejected because it could hide corruption or partial writes.
2. Return existing state before acquiring the lock.
   - Rejected because future resume behavior must be serialized with writers.
3. Release the lock before returning.
   - Rejected because future runtime slices need to continue execution under
     the acquired session lock.
