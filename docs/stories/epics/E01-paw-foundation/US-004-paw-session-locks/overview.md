
# Overview

## Current Behavior

Paw can initialize a `.paw/` project directory and has a pure in-memory session
state machine, but it does not persist session state or represent session locks.

## Target Behavior

The Paw foundation can persist one session state under
`.paw/sessions/<id>/state.json` using atomic writes and can manage a
`session.lock` file containing:

- `pid`
- `host`
- `heartbeat_ts`
- `ttl`

Lock acquisition must never wait forever. Existing locks are considered stale
when their process is dead or their heartbeat has expired.

## Affected Users

- Future Paw CLI users resuming interrupted tasks.
- Engineers and agents implementing the orchestrator and crash recovery.

## Affected Product Docs

- `docs/product/paw-runtime.md`

## Non-Goals

- Public CLI command wiring.
- Background heartbeat timers.
- Cross-process wait queues.
- Full crash-resume orchestration.
- Provider failover.
