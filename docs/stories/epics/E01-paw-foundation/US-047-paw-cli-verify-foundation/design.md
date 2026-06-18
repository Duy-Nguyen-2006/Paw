
# Design

## Domain Model

US-047 adds a CLI adapter over existing verification and lock primitives:

- `resolvePawProjectPaths` locates `.paw` without creating it.
- `resolvePawSessionPaths` derives the session state and lock paths.
- `loadDefaultPawRuntimeConfig` reads the configured v1 verification gates.
- `evaluatePawVerifyGate` creates disclosure-preserving gate decisions.
- `acquirePawSessionLock` enforces live-lock and stale-lock semantics.
- `completePawVerification` validates `VERIFYING`, persists `SLICE_DONE`, and
  preserves unverified decision metadata in the command result.
- `releasePawSessionLock` releases the lock held by the command before exit.

No durable schema fields are added.

## Application Flow

1. `handlePawCommand` routes `paw verify` to `runPawVerifyCommand`.
2. `--help` prints usage without reading or writing `.paw`.
3. Missing session id or extra arguments print an error and set exit code 1.
4. The verify helper returns `missing_project` when `.paw` is absent.
5. The verify helper returns `missing_session` when the state file is absent.
6. The helper acquires the lock or reports a live foreign lock.
7. The helper maps each configured v1 gate to an `unverified` decision because
   native command execution is not wired in this foundation slice.
8. The helper calls `completePawVerification` to persist the verifier boundary.
9. The helper releases the acquired lock before returning.
10. The formatter prints status, state transition, slice id, verified gate list,
    unverified gate list, and release status.

## Safety Boundaries

This slice does not execute `tsc`, lint, tests, build, shell commands, provider
calls, sub-agents, final report emission, patch application, checkpoint
creation, or rollback. It only proves CLI routing and durable verifier-state
persistence while honestly disclosing unverified gates.

## Alternatives Considered

1. Mark configured gates as verified when their command names exist.
   - Rejected because existence is not proof that a gate ran or passed.
2. Block instead of advancing with unverified gates.
   - Rejected for this foundation because SPEC allows unrunnable gates to be
     disclosed as unverified rather than hanging or falsely passing.
