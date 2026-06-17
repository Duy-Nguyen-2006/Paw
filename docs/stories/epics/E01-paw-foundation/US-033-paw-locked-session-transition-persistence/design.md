# Design

## Domain Model

US-033 adds an application-level transition helper over existing Paw primitives:

- Input: repository root, session id, `PawStateTransition`, and optional session
  lock options.
- Output: a discriminated result describing whether state was advanced,
  rejected by transition validation, blocked by missing/stale lock ownership,
  or blocked by another live owner.

The helper does not add a new durable schema.

## Application Flow

The helper flow is:

1. Call `getPawSessionLockStatus` for the target session.
2. Return `not_locked` when status is `unlocked`.
3. Return `not_locked` with stale metadata when status is `stale`.
4. Compare the live lock owner against `lockOptions.pid ?? process.pid` and
   `lockOptions.host ?? hostname()`.
5. Return `locked_by_other` when the live lock owner does not match.
6. Read the current session state through `readPawSessionState`.
7. Apply `transitionPawSessionState`.
8. Return `invalid_transition` with issues when validation fails, without
   writing.
9. Persist the next state through `writePawSessionState` and return `advanced`
   with previous and next state when validation succeeds.

## Safety Boundaries

The helper intentionally does not call `acquirePawSessionLock`, remove stale
lock files, or reclaim ownership. It only advances sessions for a caller that
already owns a live lock.

Malformed state is not normalized into a structured result. Existing state
readers keep throwing useful parse or validation errors so corruption is not
hidden by a normal control-flow outcome.

## Alternatives Considered

1. Acquire or reclaim the lock inside the transition helper.
   - Rejected because transition persistence should prove current ownership,
     not silently create ownership.
2. Treat stale locks as `locked_by_other`.
   - Rejected because stale locks are specifically not valid ownership for the
     current transition attempt.
3. Return malformed state as `invalid_transition`.
   - Rejected because malformed persisted state is not a transition issue and
     should remain an exceptional store-read failure.
