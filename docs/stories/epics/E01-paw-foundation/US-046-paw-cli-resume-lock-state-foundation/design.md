# Design

## Domain Model

US-046 adds a CLI adapter over existing Paw persistence and lock primitives:

- `resolvePawProjectPaths` locates `.paw` without creating it.
- `resolvePawSessionPaths` derives the session state and lock paths.
- `acquirePawSessionLock` enforces live-lock and stale-lock semantics.
- `readPawSessionState` validates the persisted state.
- `releasePawSessionLock` releases the lock held by the command before exit.

No durable schema fields are added.

## Application Flow

1. `handlePawCommand` routes `paw resume` to `runPawResumeCommand`.
2. `--help` prints usage without reading or writing `.paw`.
3. Missing session id or extra arguments print an error and set exit code 1.
4. The resume helper returns `missing_project` when `.paw` is absent.
5. The resume helper returns `missing_session` when the state file is absent.
6. The helper acquires the lock or reports a live foreign lock.
7. The helper reads and validates state under the acquired lock.
8. The helper releases the acquired lock before returning.
9. The formatter prints state, current slice, slice counts, reclaimed lock
   status, release status, and the next orchestrator resume boundary.

## Safety Boundaries

This slice does not run scout, planner, worker, reviewer, verifier, final report
emission, patch application, checkpoint creation, or rollback. It only proves
that the CLI can safely identify and lock-check a resumable session boundary.

## Alternatives Considered

1. Call `startPawTaskSession` from `paw resume`.
   - Rejected because `startPawTaskSession` can create a new session, while
     resume must require existing persisted state.
2. Keep the acquired lock after the command exits.
   - Rejected because a short-lived status-style foundation command would leave
     dead-process locks for later stale recovery.
