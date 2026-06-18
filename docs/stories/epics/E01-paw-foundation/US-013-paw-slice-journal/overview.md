
# US-013: Paw Slice Journal Persistence

## User Story

As Paw's worker, I need durable per-session slice journals so applied changes are
recorded with content hashes and completed slices are not redone on resume.

## Source References

- `SPEC.md` §8.5 Idempotency and resumability.
- `SPEC.md` §12 Persistence.
- ADR-21 Edit strategy.

## Scope

Implement append/read helpers for `.paw/sessions/<id>/slice-journal.jsonl` and
pure lookup helpers for applied-change idempotency.

## Non-Goals

- No patch application.
- No rollback implementation.
- No checkpoint snapshot creation.
- No orchestrator loop wiring.

## Acceptance Criteria

- Journal paths reuse the existing session path resolver.
- Journal entries include session id, slice id, path, change type, content hash,
  apply method, and timestamp.
- Appends create the session directory when needed and write one JSON object per
  line.
- Reading tolerates an absent journal as an empty list.
- Malformed JSONL reports a line-specific error.
- Lookup helpers identify whether a path/hash has already been applied for a
  slice.
