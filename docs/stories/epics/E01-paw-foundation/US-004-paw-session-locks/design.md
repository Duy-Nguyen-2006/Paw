
# Design

## Domain Model

The slice introduces:

- `PawSessionPaths`: paths for `.paw/sessions/<id>/state.json`,
  `slice-journal.jsonl`, `summary.md`, `transcript.jsonl`, and `session.lock`.
- `PawSessionLock`: lock owner metadata.
- `PawLockAcquireResult`: acquired or blocked with the existing owner.

## Application Flow

The future orchestrator resolves session paths, writes state atomically after
each transition, and acquires a lock before writes. If a lock exists, the helper
checks whether the lock is stale by PID liveness or heartbeat expiry. Stale
locks are reclaimed with explicit result metadata.

## Interface Contract

The TypeScript foundation under `packages/coding-agent/src/paw/` exports:

- Session path resolution.
- State write/read helpers.
- Lock acquisition, heartbeat refresh, status check, and release helpers.

The helpers return structured results instead of sleeping or polling forever.

## Data Model

Filesystem only:

```text
.paw/sessions/<session-id>/
  state.json
  slice-journal.jsonl
  summary.md
  transcript.jsonl
  session.lock
```

## UI / Platform Impact

No user-facing CLI behavior changes in this slice.

## Observability

Lock acquisition returns whether a stale lock was reclaimed so future CLI output
and traces can warn about recovery events.

## Alternatives Considered

1. Use OS-level advisory locks only.
   Rejected for this foundation slice because SPEC §9.3 requires durable
   `{pid, host, heartbeat_ts, ttl}` metadata for stale recovery.
2. Add a waiting lock acquisition loop now.
   Rejected because the spec's liveness rule says a second instance must never
   wait forever; a bounded wait policy can be added later.
