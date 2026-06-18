
# Exec Plan

## Goal

Add session state persistence and stale-lock recovery foundations required by
SPEC §9.3 and §12.

## Scope

In scope:

- Session path resolution under `.paw/sessions/<id>/`.
- Atomic session state writes and reads.
- Durable lock metadata.
- Non-waiting lock acquisition.
- Stale lock detection by heartbeat expiry and dead PID.
- Focused tests.

Out of scope:

- Public CLI command wiring.
- Background heartbeat timers.
- Full orchestrator resume logic.
- Provider failover drills.

## Risk Classification

Risk flags:

- Data model.
- Existing behavior.
- Weak proof.

Hard gates:

- Data persistence. Existing live locks must not be silently overwritten.

## Work Phases

1. Add focused tests for session state persistence and lock behavior.
2. Implement additive session store helpers under `packages/coding-agent/src/paw/`.
3. Export helpers from the Paw barrel.
4. Run focused tests and `npm run check`.
5. Update durable story evidence and trace.

## Stop Conditions

Pause for human confirmation if:

- Implementation would overwrite a live lock.
- A platform cannot support PID liveness checks.
- Existing `pi` CLI behavior would need to change.
