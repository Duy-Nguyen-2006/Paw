
# Design

## Domain Model

US-045 adds a read-only CLI adapter over existing final-report persistence:

- `resolvePawProjectPaths` locates `.paw` without creating it.
- `resolvePawSessionPaths` derives the session summary path and validates the
  session id.
- `summary.md` remains the final report source that `emitPawFinalReport` writes.
- The command returns structured result variants before formatting human output.

No durable schema fields are added.

## Application Flow

1. `handlePawCommand` routes `paw report` to `runPawReportCommand`.
2. `--help` prints usage without reading or writing `.paw`.
3. Missing session id or extra arguments print an error and set exit code 1.
4. The report helper returns `missing_project` when `.paw` is absent.
5. The report helper reads `.paw/sessions/<session-id>/summary.md` when present.
6. A missing summary returns `missing_report` with the relative path.
7. The formatter prints either markdown or a concise missing-state message.

## Safety Boundaries

The command is read-only. It does not initialize Paw, acquire locks, transition
state, emit reports, release locks, or touch git state.

## Alternatives Considered

1. Recompute the final report from state and verifier decisions.
   - Rejected because persisted `summary.md` is the durable emitted artifact.
2. Make `paw report` imply latest session discovery.
   - Rejected for this slice because explicit session ids avoid ambiguous reads
     and hidden ordering policy.
